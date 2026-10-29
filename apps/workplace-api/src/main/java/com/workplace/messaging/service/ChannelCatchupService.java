package com.workplace.messaging.service;

import com.workplace.auth.service.AssistantResolver;
import com.workplace.auth.service.AssistantSpec;
import com.workplace.global.ai.AiMemoryLine;
import com.workplace.global.ai.AiMemoryReader;
import com.workplace.global.ai.SharedAiMemoryReader;
import com.workplace.global.ai.SharedMemories;
import com.workplace.global.dto.MentionResponse;
import com.workplace.global.service.UserMentionHydrator;
import com.workplace.global.util.ChatMarkdownText;
import com.workplace.global.util.MentionParser;
import com.workplace.global.util.Texts;
import com.workplace.messaging.dto.ChannelCatchupResponse;
import com.workplace.messaging.dto.ChannelCatchupResponse.MentionItem;
import com.workplace.messaging.dto.ChannelCatchupResponse.SummaryGroup;
import com.workplace.messaging.outbound.AiAgentCatchupClient;
import com.workplace.messaging.outbound.dto.CatchupSummarizeRequest;
import com.workplace.messaging.outbound.dto.CatchupSummarizeResult;
import com.workplace.messaging.repository.ChannelMemberRepository;
import com.workplace.messaging.repository.MessageRepository;
import com.workplace.messaging.repository.MessageRepository.RecentUnread;
import java.util.List;
import java.util.Set;
import java.util.stream.Collectors;
import java.util.stream.Stream;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.server.ResponseStatusException;

/**
 * 채널 캐치업 요약 — 미읽음 배치 조회 → AI 요약(캐시) + 멘션 규칙(내 차례) 결합. 멤버십·미읽음 조회는 짧은 읽기 트랜잭션 안에서 해 RLS GUC 를
 * 보장한다(비-트랜잭션 리포 직접 호출 시 fail-closed). 메모리 읽기·캐시 확인·비서 해석·AI 호출은 그 트랜잭션이 끝난 뒤 한다.
 */
@Service
public class ChannelCatchupService {
  /** 요약 입력 미읽음 상한(비용·프롬프트 길이) — 넘으면 가장 최근 것만 요약한다(WP-1183). */
  private static final int CATCHUP_LIMIT = 200;

  /** 요약 창보다 오래된 미읽음에서 찾는 「내 차례」 멘션 상한 — 가장 최근 것부터. 카드 목록이라 이보다 많으면 다 보이기 어렵다. */
  private static final int MENTION_LIMIT = 50;

  private static final int SNIPPET_MAX = 140;

  /** 캐치업 요약 1회 호출 예산 — 비서 설정(대화형 compose 기준)과 무관한 요약 전용 값. */
  private static final int CATCHUP_MAX_TURNS = 3;

  private static final long CATCHUP_TIMEOUT_MS = 60_000L;

  private final MessageRepository messageRepo;
  private final ChannelMemberRepository memberRepo;
  private final AiAgentCatchupClient catchupClient;
  private final CatchupSummaryCache cache;
  private final AssistantResolver assistantResolver;

  /** WP-381: 요약에 싣는 요청자의 읽기 전용 메모리(공통 + 메신저). */
  private final AiMemoryReader memoryReader;

  /** WP-386: 요약에 싣는 조직 공용 메모리 리더(채널 캐치업은 공간 범위가 없다). */
  private final SharedAiMemoryReader sharedReader;

  /**
   * 멤버십·미읽음·내 차례 조회의 짧은 읽기 트랜잭션 — @Primary TenantAwareTransactionManager 로 구성해 진입 시 RLS
   * GUC(app.tenant_id) 가 주입된다.
   */
  private final TransactionTemplate readTx;

  /** 「내 차례」 미리보기의 멘션 토큰(<@id>)을 이름으로 풀 사전 — 대화 목록·스레드 인박스와 같은 hydrator(WP-1188). */
  private final UserMentionHydrator mentionHydrator;

  public ChannelCatchupService(
      MessageRepository messageRepo,
      ChannelMemberRepository memberRepo,
      AiAgentCatchupClient catchupClient,
      CatchupSummaryCache cache,
      AssistantResolver assistantResolver,
      AiMemoryReader memoryReader,
      PlatformTransactionManager txManager,
      SharedAiMemoryReader sharedReader,
      UserMentionHydrator mentionHydrator) {
    this.messageRepo = messageRepo;
    this.memberRepo = memberRepo;
    this.catchupClient = catchupClient;
    this.cache = cache;
    this.assistantResolver = assistantResolver;
    this.memoryReader = memoryReader;
    this.sharedReader = sharedReader;
    this.mentionHydrator = mentionHydrator;
    this.readTx = new TransactionTemplate(txManager);
    this.readTx.setReadOnly(true);
  }

  /**
   * 캐치업 요약. 멤버십 게이트·미읽음·내 차례는 읽기 트랜잭션 안에서 하고, 요청자 메모리 읽기·캐시 확인·비서 해석·AI 요약은 그 트랜잭션이 끝난 뒤 한다(메모리 리더를
   * 트랜잭션 밖에서 부르는 이유는 AiMemoryReader#readForEntry). 캐시 키가 메모리 지문이라 캐시 확인 전에 메모리를 읽는다. AI 호출(최대 60s)
   * 동안 커넥션을 쥐지 않는다. 캐시 적중이면 비서를 해석하지 않으므로, 비서가 없는 사람도 메모리 지문이 같으면(메모리 없음끼리 등) 남이 만든 요약을 받는다 — 요약은
   * 채널 메시지만으로 만들어 누출이 아니다.
   */
  public ChannelCatchupResponse summarize(long callerId, long channelId, long since) {
    Snapshot snap = readTx.execute(s -> snapshot(callerId, channelId, since));
    if (snap.unread().isEmpty()) {
      return new ChannelCatchupResponse(0, 0, List.of(), List.of(), List.of());
    }
    // WP-381: 요약에 싣는 요청자 메모리(공통 + 메신저). 캐시는 (메모리 지문, channelId, since, maxId) — 메모리가 같은 사람끼리만 요약을
    // 함께 쓴다. WP-383: 질의 없음(고정 + 최신) — 스펙 3.5.
    List<AiMemoryLine> memories =
        memoryReader.readForEntry(callerId, AiMemoryReader.MESSAGING, null);
    // WP-386: 조직 공용 메모리 — 지문에 함께 들어가 공용 메모리가 바뀌면 캐시된 요약을 쓰지 않는다.
    SharedMemories shared = SharedMemories.orEmpty(sharedReader.readForUser(callerId, null, null));
    CatchupSummarizeResult ai = cache.get(memories, shared, channelId, since, snap.maxId());
    if (ai == null) {
      // caller 의 비서(개인 → 공용, 토큰 보유)로 요약한다. 예전엔 id 2 를 하드코딩해 운영에서 HUMAN 계정을 가리켜
      // 토큰 발급 400 → 매 진입 502 였다(WP-110). 캐시 적중이면 해석하지 않는다.
      AssistantSpec spec = assistantResolver.resolveOrEmpty(callerId).orElse(null);
      // 비서가 없으면 AI 요약만 생략하고 "내 차례" 는 그대로 준다.
      if (spec == null) {
        return new ChannelCatchupResponse(
            snap.unreadCount(), snap.unread().size(), List.of(), snap.yourTurn(), List.of());
      }
      var req =
          new CatchupSummarizeRequest(
              snap.unread().stream()
                  .map(m -> new CatchupSummarizeRequest.Msg(m.id(), m.authorName(), m.body()))
                  .toList(),
              spec.agentUserId(),
              spec.model(),
              CATCHUP_MAX_TURNS,
              CATCHUP_TIMEOUT_MS,
              memories,
              shared.items(),
              shared.moreCount());
      ai = catchupClient.summarize(req);
      cache.put(memories, shared, channelId, since, snap.maxId(), ai);
    }

    // 근거 정직성: AI 가 돌려준 id 중 입력 미읽음 집합에 있는 것만 유지.
    Set<Long> validIds = snap.unread().stream().map(RecentUnread::id).collect(Collectors.toSet());
    return new ChannelCatchupResponse(
        snap.unreadCount(),
        snap.unread().size(),
        toGroups(ai.decisions(), validIds),
        snap.yourTurn(),
        toGroups(ai.discussion(), validIds));
  }

  /**
   * 읽기 트랜잭션 안 — 멤버십 게이트, 미읽음, 내 차례. 미읽음이 없으면 내 차례는 비운다. 요약 입력은 가장 최근 CATCHUP_LIMIT 건이고, 안 읽은 수와 멘션은
   * 상한과 무관하게 전체 미읽음에서 센다 — 상한에서 잘린 쪽의 멘션·수가 사라지지 않게(WP-1183).
   */
  private Snapshot snapshot(long callerId, long channelId, long since) {
    // 멤버십 게이트(RLS 2차 방어). 비멤버 403.
    if (!memberRepo.isMember(channelId, callerId)) {
      throw new ResponseStatusException(HttpStatus.FORBIDDEN, "채널 멤버가 아니에요.");
    }

    long maxId = messageRepo.maxMessageId(channelId);
    List<RecentUnread> unread =
        messageRepo.listLatestUnreadForChannel(channelId, since, CATCHUP_LIMIT);
    if (unread.isEmpty()) {
      return new Snapshot(maxId, 0, unread, List.of());
    }
    // 상한에 걸리지 않았으면 받은 것이 전부다 — 세는 쿼리를 아낀다.
    int unreadCount =
        unread.size() < CATCHUP_LIMIT
            ? unread.size()
            : messageRepo.countUnreadForChannel(channelId, since);

    // 멤버 수 — 2인 대화(1:1 DM/2인 채널)는 상대 발화 전부가 내 차례.
    int memberCount = memberRepo.countMembers(channelId);
    // 📌 내 차례 = 나를 멘션한 미읽음 OR (2인 대화에서 상대가 보낸 미읽음). 결정론적 규칙, AI 무관.
    // 2인 대화의 상대 발화는 요약 입력(최근 것)에서, 멘션은 상한에 잘렸으면 요약 창보다 오래된 미읽음에서도 찾는다.
    List<RecentUnread> olderMentions =
        unreadCount > unread.size()
            ? messageRepo.listUnreadMentioningBefore(
                channelId, since, unread.getFirst().id(), callerId, MENTION_LIMIT)
            : List.of();
    List<RecentUnread> turns =
        Stream.concat(
                olderMentions.stream(),
                unread.stream()
                    .filter(
                        m ->
                            (m.mentions() != null && m.mentions().contains(callerId))
                                || (memberCount == 2 && m.authorId() != callerId)))
            .toList();
    // 미리보기 본문의 멘션 이름 — 내 차례 전체의 멘션 id 를 한 번에 조회한다(N+1 방지).
    List<MentionResponse> names =
        mentionHydrator.asMentionResponses(
            turns.stream()
                .flatMap(m -> MentionParser.parse(m.body()).stream())
                .distinct()
                .toList());
    List<MentionItem> yourTurn =
        turns.stream()
            .map(m -> new MentionItem(m.id(), m.authorName(), snippet(m.body(), names)))
            .toList();
    return new Snapshot(maxId, unreadCount, unread, yourTurn);
  }

  /**
   * 읽기 트랜잭션 안 조회 결과 — 트랜잭션 밖 메모리 읽기·캐시 확인·AI 요약으로 넘긴다. unreadCount 는 전체 미읽음 수, unread 는 요약 입력(가장 최근
   * CATCHUP_LIMIT 건).
   */
  private record Snapshot(
      long maxId, int unreadCount, List<RecentUnread> unread, List<MentionItem> yourTurn) {}

  private static List<SummaryGroup> toGroups(
      List<CatchupSummarizeResult.Group> groups, Set<Long> validIds) {
    if (groups == null) {
      return List.of();
    }
    return groups.stream()
        .map(
            g ->
                new SummaryGroup(
                    g.text(),
                    g.sourceMessageIds() == null
                        ? List.of()
                        : g.sourceMessageIds().stream().filter(validIds::contains).toList()))
        .toList();
  }

  private static String snippet(String body, List<MentionResponse> names) {
    if (body == null) {
      return "";
    }
    // 「내 차례」 목록에 보이는 미리보기라 서식 기호(**·<u> 등, WP-101)를 지운 글자만 싣는다. 멘션 토큰(<@id>)은 @이름으로 바꾼다 — 웹은 미리보기를
    // 글자 그대로 그려 원문 토큰이 보였다(WP-1188). 서식을 먼저 지운다 — 바꾼 뒤 지우면 이름 속 * · ~ 까지 서식으로 오인한다(대화 목록 미리보기와 같은
    // 순서).
    String plain = MentionParser.replaceWithNames(ChatMarkdownText.toPlain(body), names);
    // 글자(코드 포인트) 단위로 자른다 — 이름을 펼치면 자르는 자리가 움직여 이모지 한가운데를 자르면 깨진 글자가 됐다.
    return Texts.truncateCodePoints(plain, SNIPPET_MAX);
  }
}
