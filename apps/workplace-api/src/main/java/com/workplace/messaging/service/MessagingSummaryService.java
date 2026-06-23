package com.workplace.messaging.service;

import com.workplace.messaging.dto.ConversationRow;
import com.workplace.messaging.dto.ConversationSummaryItem;
import com.workplace.messaging.dto.DmParticipant;
import com.workplace.messaging.dto.MessagingSummaryResponse;
import com.workplace.messaging.repository.MessagingSummaryRepository;
import com.workplace.messaging.repository.ThreadReadStateRepository;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.Set;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 홈 대시보드 대화 요약 — "내 대화 근황".
 *
 * <p>집계는 단일 @Transactional 경계에서 수행 — RLS GUC(app.tenant_id) 주입 보장(#444). 신호 우선(멘션>회신대기>새답글) → 최신순으로
 * 정렬해 상위 N 반환. 헤더 카운트는 전체 집계.
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

    List<ConversationSummaryItem> items =
        rows.stream()
            .map(r -> toItem(r, callerId, mentioned, threadReplies, participants))
            .sorted(bySignalThenRecency())
            .limit(recentLimit)
            .toList();

    // 헤더 카운트는 전역 집계(recency 후보 K 캡과 무관).
    long unread = repo.countUnreadConversations(callerId);
    long needsReply = repo.countNeedsReply(callerId);
    return new MessagingSummaryResponse(unread, needsReply, items);
  }

  /** ConversationRow → 표시용 항목. 라벨/신호/미리보기 확정. */
  private ConversationSummaryItem toItem(
      ConversationRow r,
      long callerId,
      Set<Long> mentioned,
      Map<Long, Integer> threadReplies,
      Map<Long, List<DmParticipant>> participants) {
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
        threads);
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

  /** 정렬 — 멘션 > 회신대기 > 새답글 > 최신순. */
  private static Comparator<ConversationSummaryItem> bySignalThenRecency() {
    return Comparator.comparingInt((ConversationSummaryItem i) -> i.mentioned() ? 1 : 0)
        .thenComparingInt(i -> i.needsReply() ? 1 : 0)
        .thenComparingInt(i -> i.newThreadReplyCount() > 0 ? 1 : 0)
        .reversed()
        .thenComparing(
            ConversationSummaryItem::lastMessageAt,
            Comparator.nullsLast(Comparator.reverseOrder()));
  }
}
