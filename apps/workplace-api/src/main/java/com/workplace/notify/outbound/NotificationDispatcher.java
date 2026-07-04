package com.workplace.notify.outbound;

import com.workplace.calendar.outbound.CalendarAttendeeEvents.CalendarAttendeeInvitedEvent;
import com.workplace.calendar.outbound.CalendarAttendeeEvents.CalendarRsvpChangedEvent;
import com.workplace.calendar.outbound.CalendarReminderEvents.CalendarReminderDueEvent;
import com.workplace.global.dto.UserSummary;
import com.workplace.issue.outbound.IssueDomainEvents.IssueAssignedEvent;
import com.workplace.issue.outbound.IssueDomainEvents.IssueCommentedEvent;
import com.workplace.issue.outbound.IssueDomainEvents.IssuePriorityChangedEvent;
import com.workplace.issue.outbound.IssueDomainEvents.IssueStatusChangedEvent;
import com.workplace.notify.dto.NotificationType;
import com.workplace.notify.service.NotificationService;
import java.util.List;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

/**
 * 이슈 도메인 이벤트 → 알림 생성. AFTER_COMMIT 에서만 동작(롤백 시 알림 없음), @Async("notifyEventExecutor")로 호출 스레드와 분리해
 * 알림 처리가 이슈 API 응답을 지연시키지 않는다.
 *
 * <p>워처 조회(issue_watcher, RLS 보호)는 NotificationService.createWithWatchersAndFanOut 내부에서 트랜잭션 개시 후
 * 실행되어, TenantContextTaskDecorator 가 워커 스레드에 복원한 TenantContext 를 TenantAwareTransactionManager 가
 * GUC 로 주입한 뒤 조회한다. 핸들러 예외는 도메인 트랜잭션에 영향 없도록 자체 로깅(전파 안 함).
 *
 * <p>"AI 담당자 활동"은 별도 트리거가 아니라 actor.kind=="AGENT" 인 활동 — actorId 를 그대로 실어 프론트가 AI 배지로 구분한다.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class NotificationDispatcher {

  private final NotificationService service;

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

  /** 일정 초대 → 피초대자(HUMAN)에게 CALENDAR_INVITED 알림. */
  @Async("notifyEventExecutor")
  @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
  public void onCalendarAttendeeInvited(CalendarAttendeeInvitedEvent e) {
    try {
      service.createEventNotificationAndFanOut(
          e.recipientId(), NotificationType.CALENDAR_INVITED, e.actorId(), e.eventId());
    } catch (Exception ex) {
      log.warn(
          "[notify] 초대 알림 실패 eventId={} recipientId={}: {}",
          e.eventId(),
          e.recipientId(),
          ex.getMessage());
    }
  }

  /** RSVP 변경 → 주최자에게 CALENDAR_RSVP_CHANGED 알림. */
  @Async("notifyEventExecutor")
  @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
  public void onCalendarRsvpChanged(CalendarRsvpChangedEvent e) {
    try {
      service.createEventNotificationAndFanOut(
          e.recipientId(), NotificationType.CALENDAR_RSVP_CHANGED, e.actorId(), e.eventId());
    } catch (Exception ex) {
      log.warn(
          "[notify] RSVP 알림 실패 eventId={} recipientId={}: {}",
          e.eventId(),
          e.recipientId(),
          ex.getMessage());
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

  /**
   * 코멘트: 담당자 ∪ 워처. 워처 조회는 service 트랜잭션 내에서 실행 — GUC 주입 후 RLS 통과.
   *
   * <p>기존에는 watcherRepo.findUserIdsByIssue() 를 @Async 핸들러에서 직접 호출해 트랜잭션 밖 bare jOOQ 조회가 발생했다.
   * TenantContext 도 없어 RLS 가 issue_watcher 를 0행 반환(fail-closed). 수정:
   * service.createWithWatchersAndFanOut 에서 단일 트랜잭션으로 조회+insert+fan-out.
   */
  @Async("notifyEventExecutor")
  @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
  public void onIssueCommented(IssueCommentedEvent e) {
    try {
      service.createWithWatchersAndFanOut(
          NotificationType.COMMENTED,
          e.issueId(),
          e.assignees(),
          actorId(e.actor()),
          e.commentId());
    } catch (Exception ex) {
      log.warn("[notify] commented 알림 실패 issueId={}: {}", e.issueId(), ex.getMessage());
    }
  }

  /**
   * 상태변경: 담당자 ∪ 워처. 워처 조회는 service 트랜잭션 내에서 실행 — GUC 주입 후 RLS 통과.
   *
   * @see #onIssueCommented
   */
  @Async("notifyEventExecutor")
  @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
  public void onIssueStatusChanged(IssueStatusChangedEvent e) {
    try {
      service.createWithWatchersAndFanOut(
          NotificationType.STATUS_CHANGED, e.issueId(), e.assignees(), actorId(e.actor()), null);
    } catch (Exception ex) {
      log.warn("[notify] status_changed 알림 실패 issueId={}: {}", e.issueId(), ex.getMessage());
    }
  }

  /**
   * 우선순위 변경: 담당자 ∪ 워처. 상태 변경과 대칭적으로 모든 변경에 알림(임계치 조건 없음, #613). 워처 조회는 service 트랜잭션 내에서 실행 — GUC 주입
   * 후 RLS 통과.
   *
   * @see #onIssueCommented
   */
  @Async("notifyEventExecutor")
  @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
  public void onIssuePriorityChanged(IssuePriorityChangedEvent e) {
    try {
      service.createWithWatchersAndFanOut(
          NotificationType.PRIORITY_CHANGED, e.issueId(), e.assignees(), actorId(e.actor()), null);
    } catch (Exception ex) {
      log.warn("[notify] priority_changed 알림 실패 issueId={}: {}", e.issueId(), ex.getMessage());
    }
  }

  private static Long actorId(UserSummary actor) {
    return actor == null ? null : actor.id();
  }
}
