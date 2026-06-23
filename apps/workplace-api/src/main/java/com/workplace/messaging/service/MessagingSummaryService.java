package com.workplace.messaging.service;

import com.workplace.messaging.dto.ConversationRow;
import com.workplace.messaging.dto.ConversationSummaryItem;
import com.workplace.messaging.dto.DmParticipant;
import com.workplace.messaging.dto.MessagingSummaryResponse;
import com.workplace.messaging.repository.ConversationAttentionRepository;
import com.workplace.messaging.repository.MessagingSummaryRepository;
import com.workplace.messaging.repository.ThreadReadStateRepository;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 홈 대시보드 대화 요약 — "내 대화 근황".
 *
 * <p>집계는 단일 @Transactional 경계에서 수행 — RLS GUC(app.tenant_id) 주입 보장(#444). 신호 우선(AI발굴/멘션>회신대기>새답글) →
 * 최신순으로 정렬해 상위 N 반환. 헤더 카운트는 전체 집계.
 */
@Service
@RequiredArgsConstructor
public class MessagingSummaryService {

  /** recency 후보 상위 K(여기서 신호 재정렬 후 N 선택). 오래된 멘션 누락은 Synthesis 가 보완. */
  private static final int CANDIDATE_LIMIT = 20;

  /** 미리보기 본문 최대 길이. */
  private static final int PREVIEW_LEN = 80;

  private final MessagingSummaryRepository repo;
  private final ThreadReadStateRepository threadRepo;
  /** AI 발굴 마크 리포 — 안읽음 대화에 aiReason 신호를 싣기 위해 주입. */
  private final ConversationAttentionRepository conversationAttentionRepo;

  /**
   * 홈 위젯용 대화 요약.
   *
   * @param callerId 조회 주체 사용자 id
   * @param recentLimit 최근 대화 상위 N
   */
  @Transactional(readOnly = true)
  public MessagingSummaryResponse summary(long callerId, int recentLimit) {
    List<ConversationRow> rows = repo.recentConversationRows(callerId, CANDIDATE_LIMIT);
    List<Long> ids = rows.stream().map(ConversationRow::channelId).toList();

    Set<Long> mentioned = repo.mentionedChannelIds(ids, callerId);
    Map<Long, Integer> threadReplies = threadRepo.countUnreadThreadsByChannel(ids, callerId);
    Map<Long, List<DmParticipant>> participants = repo.participantsByChannel(ids);

    // AI 발굴 마크: channelId → reason. 같은 @Transactional 경계에서 조회 → RLS GUC 보장.
    Map<Long, String> aiReasonByChannel =
        conversationAttentionRepo.listForUser(callerId).stream()
            .collect(
                Collectors.toMap(
                    ConversationAttentionRepository.AttentionMark::channelId,
                    ConversationAttentionRepository.AttentionMark::reason,
                    (a, b) -> a)); // 중복 시 첫 번째 유지

    List<ConversationSummaryItem> items =
        rows.stream()
            .map(r -> toItem(r, callerId, mentioned, threadReplies, participants, aiReasonByChannel))
            .sorted(bySignalThenRecency())
            .limit(recentLimit)
            .toList();

    // 헤더 카운트는 전역 집계(recency 후보 K 캡과 무관).
    long unread = repo.countUnreadConversations(callerId);
    long needsReply = repo.countNeedsReply(callerId);
    // AI 발굴 마크가 있고 여전히 안읽음인 대화 수 — needsReplyCount 와 동급 헤더 카운트.
    long aiAttentionCount = repo.countAiAttentionUnread(callerId);
    // "확인 필요" KPI 단일값 — 회신 대기 ∪ AI 발굴 안읽음의 합집합 dedup(needsReply+aiAttention 이중 집계 제거).
    long attentionCount = repo.countAttentionConversations(callerId);
    return new MessagingSummaryResponse(
        unread, needsReply, aiAttentionCount, attentionCount, items);
  }

  /** ConversationRow → 표시용 항목. 라벨/신호/미리보기/aiReason 확정. */
  private ConversationSummaryItem toItem(
      ConversationRow r,
      long callerId,
      Set<Long> mentioned,
      Map<Long, Integer> threadReplies,
      Map<Long, List<DmParticipant>> participants,
      Map<Long, String> aiReasonByChannel) {
    boolean isDm = "DM".equals(r.kind());
    String label =
        isDm
            ? dmLabel(participants.getOrDefault(r.channelId(), List.of()), callerId)
            : r.channelName();
    // DM 안읽음 = 상대가 마지막 발화 → 회신대기
    boolean needsReply = isDm && r.unreadCount() > 0;
    int threads = threadReplies.getOrDefault(r.channelId(), 0);
    // 본인 메시지이면 lastAuthorName 표시 불필요
    String authorName =
        (r.lastAuthorId() != null && r.lastAuthorId() == callerId) ? null : r.lastAuthorName();
    // AI 발굴 사유 — 안읽음이고 마크가 있을 때만 노출(읽으면 clear).
    String aiReason =
        (r.unreadCount() > 0 && aiReasonByChannel.containsKey(r.channelId()))
            ? aiReasonByChannel.get(r.channelId())
            : null;
    return new ConversationSummaryItem(
        r.kind(),
        r.channelId(),
        label,
        authorName,
        preview(r.lastBody()),
        r.lastMessageAt(),
        r.unreadCount(),
        mentioned.contains(r.channelId()),
        needsReply,
        threads,
        aiReason);
  }

  /** DM 표시명 — 본인 외 참가자. 백엔드에서 라벨 확정(프론트 dmDisplayName 과 동일 규칙). */
  private static String dmLabel(List<DmParticipant> ps, long callerId) {
    var others = ps.stream().filter(p -> p.userId() == null || p.userId() != callerId).toList();
    if (others.isEmpty()) return "(나)";
    if (others.size() == 1) return others.get(0).name();
    if (others.size() <= 3)
      return String.join(", ", others.stream().map(DmParticipant::name).toList());
    return others.get(0).name() + ", " + others.get(1).name() + " 외 " + (others.size() - 2) + "명";
  }

  /** 본문 미리보기 — 개행 제거 + 길이 제한. */
  private static String preview(String body) {
    if (body == null) return "";
    String oneLine = body.replaceAll("\\s+", " ").trim();
    return oneLine.length() <= PREVIEW_LEN ? oneLine : oneLine.substring(0, PREVIEW_LEN) + "…";
  }

  /**
   * 정렬 — (AI발굴 | 멘션) > 회신대기 > 새답글 > 최신순.
   *
   * <p>AI 발굴(aiReason != null)을 멘션과 동급 high 신호로 처리 — 두 신호 중 하나라도 있으면 최상위 tier.
   */
  private static Comparator<ConversationSummaryItem> bySignalThenRecency() {
    return Comparator.comparingInt(
            (ConversationSummaryItem i) -> (i.mentioned() || i.aiReason() != null) ? 1 : 0)
        .thenComparingInt(i -> i.needsReply() ? 1 : 0)
        .thenComparingInt(i -> i.newThreadReplyCount() > 0 ? 1 : 0)
        .reversed()
        .thenComparing(
            ConversationSummaryItem::lastMessageAt,
            Comparator.nullsLast(Comparator.reverseOrder()));
  }
}
