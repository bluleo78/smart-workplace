package com.workplace.notify.outbound;

import com.workplace.calendar.outbound.CalendarReminderEvents.CalendarReminderDueEvent;
import com.workplace.global.dto.UserSummary;
import com.workplace.issue.outbound.IssueDomainEvents.IssueAssignedEvent;
import com.workplace.issue.outbound.IssueDomainEvents.IssueCommentedEvent;
import com.workplace.issue.outbound.IssueDomainEvents.IssueStatusChangedEvent;
import com.workplace.notify.dto.NotificationType;
import com.workplace.notify.service.NotificationService;
import com.workplace.watcher.repository.IssueWatcherRepository;
import java.util.ArrayList;
import java.util.List;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

/**
 * 이슈 도메인 이벤트 → 알림 생성. AFTER_COMMIT 에서만 동작(롤백 시 알림 없음), @Async("notifyEventExecutor")로 호출 스레드와 분리해
 * 알림 처리가 이슈 API 응답을 지연시키지 않는다. 수신자 후보만 해석하고(담당자=이벤트 페이로드, 워처=리포 조회), actor 제외/중복 제거는
 * NotificationService 가 담당한다. 핸들러 예외는 도메인 트랜잭션에 영향 없도록 자체 로깅(전파 안 함).
 *
 * <p>"AI 담당자 활동"은 별도 트리거가 아니라 actor.kind=="AGENT" 인 활동 — actorId 를 그대로 실어 프론트가 AI 배지로 구분한다.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class NotificationDispatcher {

  private final NotificationService service;
  private final IssueWatcherRepository watcherRepo;

  /** 배정: 새로 추가된 담당자에게(added). */
  @Async("notifyEventExecutor")
  @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
  public void onIssueAssigned(IssueAssignedEvent e) {
    try {
      List<Long> recipients = e.added().stream().map(UserSummary::id).toList();
      service.createAndFanOut(
          NotificationType.ASSIGNED, recipients, actorId(e.actor()), e.issueId(), null);
    } catch (Exception ex) {
      log.warn("[notify] assigned 알림 실패 issueId={}: {}", e.issueId(), ex.getMessage());
    }
  }

  /** 캘린더 리마인더 발화 → 일정 소유자에게 알림. actor/issue 없음. */
  @Async("notifyEventExecutor")
  @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
  public void onCalendarReminderDue(CalendarReminderDueEvent e) {
    try {
      service.createReminderAndFanOut(e.ownerId(), e.eventId());
    } catch (Exception ex) {
      log.warn("[notify] reminder 알림 실패 eventId={}: {}", e.eventId(), ex.getMessage());
    }
  }

  /** 코멘트: 담당자 ∪ 워처. */
  @Async("notifyEventExecutor")
  @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
  public void onIssueCommented(IssueCommentedEvent e) {
    try {
      service.createAndFanOut(
          NotificationType.COMMENTED,
          unionAssigneesAndWatchers(e.issueId(), e.assignees()),
          actorId(e.actor()),
          e.issueId(),
          e.commentId());
    } catch (Exception ex) {
      log.warn("[notify] commented 알림 실패 issueId={}: {}", e.issueId(), ex.getMessage());
    }
  }

  /** 상태변경: 담당자 ∪ 워처. */
  @Async("notifyEventExecutor")
  @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
  public void onIssueStatusChanged(IssueStatusChangedEvent e) {
    try {
      service.createAndFanOut(
          NotificationType.STATUS_CHANGED,
          unionAssigneesAndWatchers(e.issueId(), e.assignees()),
          actorId(e.actor()),
          e.issueId(),
          null);
    } catch (Exception ex) {
      log.warn("[notify] status_changed 알림 실패 issueId={}: {}", e.issueId(), ex.getMessage());
    }
  }

  /** 담당자(이벤트 페이로드 — 같은 트랜잭션이라 정확) ∪ 워처(경량 조회). 중복/actor 제외는 service 가 처리. */
  private List<Long> unionAssigneesAndWatchers(long issueId, List<UserSummary> assignees) {
    List<Long> ids = new ArrayList<>();
    if (assignees != null) assignees.forEach(u -> ids.add(u.id()));
    ids.addAll(watcherRepo.findUserIdsByIssue(issueId));
    return ids;
  }

  private static Long actorId(UserSummary actor) {
    return actor == null ? null : actor.id();
  }
}
