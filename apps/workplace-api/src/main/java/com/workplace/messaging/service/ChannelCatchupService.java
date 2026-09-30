package com.workplace.messaging.service;

import com.workplace.auth.service.AssistantResolver;
import com.workplace.auth.service.AssistantSpec;
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
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

/**
 * 채널 캐치업 요약 — 미읽음 배치 조회 → AI 요약(캐시) + 멘션 규칙(내 차례) 결합. @Transactional 경계 안에서 RLS GUC 보장(비-트랜잭션 리포 직접
 * 호출 시 fail-closed).
 */
@Service
@RequiredArgsConstructor
public class ChannelCatchupService {
  /** 요약 입력 미읽음 상한(비용·프롬프트 길이). */
  private static final int CATCHUP_LIMIT = 200;

  private static final int SNIPPET_MAX = 140;

  /** 캐치업 요약 1회 호출 예산 — 비서 설정(대화형 compose 기준)과 무관한 요약 전용 값. */
  private static final int CATCHUP_MAX_TURNS = 3;

  private static final long CATCHUP_TIMEOUT_MS = 60_000L;

  private final MessageRepository messageRepo;
  private final ChannelMemberRepository memberRepo;
  private final AiAgentCatchupClient catchupClient;
  private final CatchupSummaryCache cache;
  private final AssistantResolver assistantResolver;

  @Transactional(readOnly = true)
  public ChannelCatchupResponse summarize(long callerId, long channelId, long since) {
    // 멤버십 게이트(RLS 2차 방어). 비멤버 403.
    if (!memberRepo.isMember(channelId, callerId)) {
      throw new ResponseStatusException(HttpStatus.FORBIDDEN, "채널 멤버가 아니에요.");
    }

    long maxId = messageRepo.maxMessageId(channelId);
    List<RecentUnread> unread =
        messageRepo.listRecentUnreadForChannel(channelId, since, CATCHUP_LIMIT);
    if (unread.isEmpty()) {
      return new ChannelCatchupResponse(0, List.of(), List.of(), List.of());
    }

    // 멤버 수 — 2인 대화(1:1 DM/2인 채널)는 상대 발화 전부가 내 차례.
    int memberCount = memberRepo.countMembers(channelId);
    // 📌 내 차례 = 나를 멘션한 미읽음 OR (2인 대화에서 상대가 보낸 미읽음). 결정론적 규칙, AI 무관.
    List<MentionItem> yourTurn =
        unread.stream()
            .filter(
                m ->
                    (m.mentions() != null && m.mentions().contains(callerId))
                        || (memberCount == 2 && m.authorId() != callerId))
            .map(m -> new MentionItem(m.id(), m.authorName(), snippet(m.body())))
            .toList();

    // AI 요약 — 캐시 (channelId, since, maxId).
    CatchupSummarizeResult ai = cache.get(channelId, since, maxId);
    if (ai == null) {
      // caller 의 비서(개인 → 공용, 토큰 보유)로 요약한다. 예전엔 id 2 를 하드코딩해 운영에서 HUMAN 계정을 가리켜
      // 토큰 발급 400 → 매 진입 502 였다(WP-110). 비서가 없으면 AI 요약만 생략하고 "내 차례" 는 그대로 준다.
      // 캐시 키는 caller 무관(채널 단위) — 모든 멤버가 같은 메시지를 보므로 첫 요청자 비서의 요약을 공유한다.
      AssistantSpec spec = assistantResolver.resolveOrEmpty(callerId).orElse(null);
      if (spec == null) {
        return new ChannelCatchupResponse(unread.size(), List.of(), yourTurn, List.of());
      }
      var req =
          new CatchupSummarizeRequest(
              unread.stream()
                  .map(m -> new CatchupSummarizeRequest.Msg(m.id(), m.authorName(), m.body()))
                  .toList(),
              spec.agentUserId(),
              spec.model(),
              CATCHUP_MAX_TURNS,
              CATCHUP_TIMEOUT_MS);
      ai = catchupClient.summarize(req);
      cache.put(channelId, since, maxId, ai);
    }

    // 근거 정직성: AI 가 돌려준 id 중 입력 미읽음 집합에 있는 것만 유지.
    Set<Long> validIds = unread.stream().map(RecentUnread::id).collect(Collectors.toSet());
    return new ChannelCatchupResponse(
        unread.size(),
        toGroups(ai.decisions(), validIds),
        yourTurn,
        toGroups(ai.discussion(), validIds));
  }

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

  private static String snippet(String body) {
    if (body == null) {
      return "";
    }
    return body.length() <= SNIPPET_MAX ? body : body.substring(0, SNIPPET_MAX) + "…";
  }
}
