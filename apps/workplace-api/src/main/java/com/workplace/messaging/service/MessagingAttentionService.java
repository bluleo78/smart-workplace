package com.workplace.messaging.service;

import com.workplace.messaging.outbound.AiAgentMessagingClient;
import com.workplace.messaging.outbound.dto.MessagingClassifyRequest;
import com.workplace.messaging.repository.ChannelMemberRepository;
import com.workplace.messaging.repository.ChannelRepository;
import com.workplace.messaging.repository.ConversationAttentionRepository;
import com.workplace.messaging.repository.MessageRepository;
import com.workplace.messaging.repository.MessagingClassifyWatermarkRepository;
import java.util.ArrayList;
import java.util.List;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 메시징 어텐션 — 일반 채널 메시지 도착 시 "암묵적 관련성"을 AI 로 발굴해 conversation_attention 에 기록.
 *
 * <p>비용 깔때기: ① 도메인 게이트(DM 제외) → ② 이름 프리필터(무료, 멤버 이름 토큰 없으면 AI 미호출) → ③ watermark 게이트(버스트 코얼레싱: 마지막
 * 분류 이후 새 메시지 없으면 AI 0) → ④ 배치 조회 → ⑤ AI(haiku) 1회 호출 → ⑥ 결과로 fan-out.
 *
 * <p>directed(DM/멘션/스레드) 경로는 호출 안 함 — 요약 라이브 쿼리가 처리.
 */
@Service
@Slf4j
@RequiredArgsConstructor
public class MessagingAttentionService {

  private final MessageRepository messageRepo;
  private final ChannelRepository channelRepo;
  private final ChannelMemberRepository memberRepo;
  private final ConversationAttentionRepository attnRepo;
  private final MessagingClassifyWatermarkRepository wmRepo;
  private final AiAgentMessagingClient aiClient;

  /** 한 배치에서 가져올 최대 메시지 수. */
  private static final int BATCH_LIMIT = 30;

  /** ai-agent 어시스턴트 기본 ID (메일과 동일). */
  private static final long ASSISTANT_AGENT_ID = 2L;

  /** 분류에 사용할 haiku 모델. */
  private static final String CLASSIFY_MODEL = "claude-haiku-4-5-20251001";

  /**
   * 비동기 진입점 — @Async 스레드에서 새 트랜잭션을 열어 tenant GUC 를 주입한다. (작성자 스레드 컨텍스트에 의존하지 않음 — fail-safe RLS).
   */
  @Async("aiAgentEventExecutor")
  @Transactional
  public void onChannelMessage(long channelId) {
    onChannelMessageSync(channelId);
  }

  /**
   * 테스트·동기 호출용 본체. 비용 깔때기 ①~⑥. 트리거 메시지 id 는 받지 않는다 — watermark 비교는 본체에서 maxMessageId(channelId)로
   * 재조회한다.
   *
   * @param channelId 메시지가 속한 채널
   */
  @Transactional
  public void onChannelMessageSync(long channelId) {
    // ① 도메인 게이트: DM 은 이 경로를 타지 않음 (1:1/그룹 DM → 요약 라이브 쿼리 경로).
    if ("DM".equals(channelRepo.findKind(channelId))) return;

    // ③ watermark 게이트(핵심 비용 레버 + 버스트 코얼레싱):
    //    마지막 분류 이후 새 메시지가 없으면 AI 0 — "변함없는 대화는 재분류 없음".
    long wm = wmRepo.get(channelId);
    long maxId = messageRepo.maxMessageId(channelId);
    if (maxId <= wm) return;

    // 멤버 목록 (userId + name) — 이름 토큰 생성 + AI 멤버 목록 전달용.
    // 멤버가 없는 채널은 배치 조회 없이 watermark 전진 후 종료 (불필요한 DB 쿼리 차단).
    var members = memberRepo.listMembers(channelId);
    if (members.isEmpty()) {
      wmRepo.advance(channelId, maxId);
      return;
    }

    // 배치 조회: watermark 이후 메시지만 (과거 재독 없음, 비용 상한 BATCH_LIMIT).
    var batch = messageRepo.listRecentUnreadForChannel(channelId, wm, BATCH_LIMIT);
    if (batch.isEmpty()) {
      wmRepo.advance(channelId, maxId);
      return;
    }

    // ② 이름 프리필터(무료): 멤버당 { 풀네임, 이름파트 } 2개 토큰만 사용.
    //    이름파트 = 한국어 호명 관습상 성을 뗀 부분 (예: "양동희" → "동희", 3자 미만이면 풀네임=이름파트).
    //    "양동" 같은 2자 슬라이딩 토큰은 일반 어휘와 겹쳐 과매칭(AI 비용 낭비) 위험이 있어 제거.
    //    예) "양동희" → {"양동희", "동희"} → "동희가 배포했나?" 에서 "동희" 일치.
    List<String> nameTokens = new ArrayList<>();
    for (var m : members) {
      String name = m.name();
      if (name == null || name.length() < 2) continue;
      // 공백 제거 후 풀네임 + 이름파트 토큰 추가
      String compact = name.replaceAll("\\s+", "");
      nameTokens.add(compact); // 풀네임
      // 이름파트: 3자 이상이면 첫 자(성) 제거, 미만이면 풀네임과 동일
      String givenName = compact.length() >= 3 ? compact.substring(1) : compact;
      if (!givenName.equals(compact)) {
        nameTokens.add(givenName);
      }
    }

    long newWatermark = batch.get(batch.size() - 1).id();

    // 배치 본문에 이름 토큰이 하나라도 등장하지 않으면 AI 미호출 + watermark 전진(재분류 방지).
    boolean anyName =
        batch.stream()
            .anyMatch(
                msg ->
                    msg.body() != null
                        && nameTokens.stream().anyMatch(tok -> msg.body().contains(tok)));
    if (!anyName) {
      wmRepo.advance(channelId, newWatermark);
      return;
    }

    // ⑤ AI 호출 1회 — 배치 메시지 + 멤버 목록을 haiku 에 전달.
    var req =
        new MessagingClassifyRequest(
            batch.stream()
                .map(b -> new MessagingClassifyRequest.Msg(b.authorName(), b.body()))
                .toList(),
            members.stream()
                .map(m -> new MessagingClassifyRequest.Member(m.userId(), m.name()))
                .toList(),
            ASSISTANT_AGENT_ID,
            CLASSIFY_MODEL,
            4,
            30_000L);
    log.info("messaging-classify 호출 channel={} batch={}", channelId, batch.size());
    var res = aiClient.classify(req);

    // 결과 유무와 무관하게 watermark 전진 — relevant=[] 여도 영구 재분류 차단.
    wmRepo.advance(channelId, newWatermark);

    // ⑥ 양성 결과만 fan-out write. upsert 는 멱등(읽은 뒤 새 관련 메시지 도착 시 reason/watermark 갱신).
    for (var rel : res.relevant()) {
      attnRepo.upsert(channelId, rel.userId(), rel.reason(), newWatermark);
    }
  }
}
