package com.workplace.notify.service;

import com.workplace.global.dto.UserSummary;
import com.workplace.global.realtime.SseRegistry;
import com.workplace.notify.dto.NotificationResponse;
import com.workplace.notify.dto.NotificationType;
import com.workplace.notify.repository.NotificationRepository;
import com.workplace.watcher.repository.IssueWatcherRepository;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 알림 생성·조회·읽음. 생성 시 수신자 후보에서 actor 본인 제외 + 중복 제거 후 persist 하고, 같은 수신자 집합에 SSE("notify.created")로
 * fan-out 한다. 모든 조회/변경은 recipientId 스코프(타 사용자 알림 접근 불가).
 */
@Service
@RequiredArgsConstructor
public class NotificationService {

  private final NotificationRepository repo;
  private final SseRegistry registry;
  private final IssueWatcherRepository watcherRepo;

  /** 수신자 확정(actor 제외·중복 제거) → batch insert → SSE fan-out. 빈 수신자면 no-op. */
  @Transactional
  public void createAndFanOut(
      NotificationType type, List<Long> recipientIds, Long actorId, long issueId, Long commentId) {
    List<Long> recipients =
        recipientIds.stream()
            .filter(Objects::nonNull)
            .distinct()
            .filter(id -> !id.equals(actorId))
            .toList();
    if (recipients.isEmpty()) return;
    repo.insertBatch(recipients, type, actorId, issueId, commentId);
    // 페이로드는 경량(클라가 수신 즉시 쿼리 invalidate). 상세는 REST 재조회.
    registry.fanOut(recipients, "notify.created", Map.of("type", type.name(), "issueId", issueId));
  }

  /**
   * 워처 조회 + 알림 생성 + fan-out 을 단일 트랜잭션 안에서 수행한다.
   *
   * <p>NotificationDispatcher 의 @Async AFTER_COMMIT 핸들러가 이 메서드를 호출하면, 이 메서드가 시작하는 트랜잭션 doBegin 시점에
   * TenantContext 가 워커 스레드에 복원(TaskDecorator 에 의해)되어 TenantAwareTransactionManager 가
   * GUC(app.tenant_id) 를 올바르게 주입한다. 결과적으로 RLS 보호 테이블(issue_watcher)의 조회가 올바른 테넌트 스코프에서 실행된다.
   *
   * <p>assignees 는 이벤트 페이로드(같은 트랜잭션에서 확정된 값), 워처는 이 트랜잭션 내 조회.
   */
  @Transactional
  public void createWithWatchersAndFanOut(
      NotificationType type,
      long issueId,
      List<UserSummary> assignees,
      Long actorId,
      Long commentId) {
    List<Long> ids = new ArrayList<>();
    if (assignees != null) assignees.forEach(u -> ids.add(u.id()));
    // 트랜잭션 내에서 조회 — TenantAwareTransactionManager 가 GUC 를 주입한 후이므로 RLS 정책 통과.
    ids.addAll(watcherRepo.findUserIdsByIssue(issueId));
    createAndFanOut(type, ids, actorId, issueId, commentId);
  }

  /**
   * 캘린더 리마인더 알림 — 수신자=일정 소유자 1인, actor 없음. insert 후 동일 수신자에게 SSE fan-out. (이슈 경로와 분리 — issue_id 없는
   * 알림을 안전히 생성하고 Map.of NPE 회피)
   */
  @Transactional
  public void createReminderAndFanOut(long recipientId, long eventId) {
    repo.insertReminder(recipientId, eventId);
    registry.fanOut(
        List.of(recipientId), "notify.created", Map.of("type", "REMINDER", "eventId", eventId));
  }

  @Transactional(readOnly = true)
  public List<NotificationResponse> listRecent(long recipientId, int limit) {
    return repo.listRecent(recipientId, limit);
  }

  @Transactional(readOnly = true)
  public long countUnread(long recipientId) {
    return repo.countUnread(recipientId);
  }

  @Transactional
  public int markRead(long recipientId, long id) {
    return repo.markRead(recipientId, id);
  }

  @Transactional
  public int markAllRead(long recipientId) {
    return repo.markAllRead(recipientId);
  }
}
