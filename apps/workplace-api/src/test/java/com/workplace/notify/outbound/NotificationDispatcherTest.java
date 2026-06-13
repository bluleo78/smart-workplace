package com.workplace.notify.outbound;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;

import com.workplace.calendar.outbound.CalendarReminderEvents.CalendarReminderDueEvent;
import com.workplace.global.dto.UserSummary;
import com.workplace.issue.outbound.IssueDomainEvents.IssueAssignedEvent;
import com.workplace.issue.outbound.IssueDomainEvents.IssueCommentedEvent;
import com.workplace.issue.outbound.IssueDomainEvents.IssueStatusChangedEvent;
import com.workplace.notify.dto.NotificationType;
import com.workplace.notify.service.NotificationService;
import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.mockito.Mockito;

/** NotificationDispatcher — 수신자 해석 검증. Spring 컨텍스트 없이 직접 호출. */
class NotificationDispatcherTest {

  private static final UserSummary HUMAN_ACTOR = new UserSummary(1L, "alice", "Alice", "HUMAN");
  private static final UserSummary AGENT_ACTOR = new UserSummary(9L, "ai", "AI", "AGENT");
  private static final UserSummary ASSIGNEE_A = new UserSummary(2L, "bob", "Bob", "HUMAN");
  private static final UserSummary ASSIGNEE_B = new UserSummary(3L, "carol", "Carol", "HUMAN");

  private NotificationService service;
  private NotificationDispatcher dispatcher;

  @BeforeEach
  void setUp() {
    service = Mockito.mock(NotificationService.class);
    dispatcher = new NotificationDispatcher(service);
  }

  @Test
  @SuppressWarnings("unchecked")
  void onIssueAssigned_usesAdded_typeAssigned_noComment() {
    var e =
        new IssueAssignedEvent(
            10L,
            "WP",
            "WP-10",
            "t",
            HUMAN_ACTOR,
            List.of(ASSIGNEE_A, ASSIGNEE_B),
            List.of(ASSIGNEE_A),
            List.of(),
            Instant.now());

    dispatcher.onIssueAssigned(e);

    var recipients = ArgumentCaptor.forClass(List.class);
    verify(service)
        .createAndFanOut(
            eq(NotificationType.ASSIGNED), recipients.capture(), eq(1L), eq(10L), eq(null));
    assertThat(recipients.getValue()).containsExactly(2L);
  }

  /**
   * commented: dispatcher 는 service.createWithWatchersAndFanOut 에 assignees 와 issueId 를 넘긴다. 워처 조회는
   * 서비스 트랜잭션 내에서 발생(RLS-safe). 여기서는 service 메서드 호출 인수만 검증.
   */
  @Test
  void onIssueCommented_delegatesToCreateWithWatchersAndFanOut() {
    var e =
        new IssueCommentedEvent(
            11L, "WP", "WP-11", "t", HUMAN_ACTOR, List.of(ASSIGNEE_A), 55L, "hi", Instant.now());

    dispatcher.onIssueCommented(e);

    verify(service)
        .createWithWatchersAndFanOut(
            eq(NotificationType.COMMENTED), eq(11L), eq(List.of(ASSIGNEE_A)), eq(1L), eq(55L));
  }

  /**
   * status_changed: dispatcher 는 service.createWithWatchersAndFanOut 에 assignees 와 issueId 를 넘긴다.
   */
  @Test
  void onIssueStatusChanged_delegatesToCreateWithWatchersAndFanOut_agentActorPreserved() {
    var e =
        new IssueStatusChangedEvent(
            12L,
            "WP",
            "WP-12",
            "t",
            AGENT_ACTOR,
            List.of(ASSIGNEE_A, ASSIGNEE_B),
            "TODO",
            "IN_PROGRESS",
            Instant.now());

    dispatcher.onIssueStatusChanged(e);

    verify(service)
        .createWithWatchersAndFanOut(
            eq(NotificationType.STATUS_CHANGED),
            eq(12L),
            eq(List.of(ASSIGNEE_A, ASSIGNEE_B)),
            eq(9L),
            eq(null));
  }

  @Test
  void onCalendarReminderDue_createsReminderForOwner() {
    var e = new CalendarReminderDueEvent(77L, 5L, Instant.now());

    dispatcher.onCalendarReminderDue(e);

    verify(service).createReminderAndFanOut(5L, 77L);
  }

  @Test
  void onCalendarReminderDue_serviceThrows_isSwallowed() {
    Mockito.doThrow(new RuntimeException("boom"))
        .when(service)
        .createReminderAndFanOut(Mockito.anyLong(), Mockito.anyLong());

    // 예외가 전파되지 않아야 한다
    dispatcher.onCalendarReminderDue(new CalendarReminderDueEvent(1L, 1L, Instant.now()));
  }

  @Test
  void onIssueAssigned_nullActor_passesNullActorId() {
    var e =
        new IssueAssignedEvent(
            13L,
            "WP",
            "WP-13",
            "t",
            null,
            List.of(ASSIGNEE_A),
            List.of(ASSIGNEE_A),
            List.of(),
            Instant.now());

    dispatcher.onIssueAssigned(e);

    verify(service)
        .createAndFanOut(eq(NotificationType.ASSIGNED), any(), eq(null), eq(13L), eq(null));
  }

  @Test
  void serviceThrows_isSwallowed_noPropagation() {
    Mockito.doThrow(new RuntimeException("boom"))
        .when(service)
        .createAndFanOut(any(), any(), any(), Mockito.anyLong(), any());
    var e =
        new IssueAssignedEvent(
            14L,
            "WP",
            "WP-14",
            "t",
            HUMAN_ACTOR,
            List.of(ASSIGNEE_A),
            List.of(ASSIGNEE_A),
            List.of(),
            Instant.now());

    dispatcher.onIssueAssigned(e); // 예외가 전파되지 않아야 한다
    verify(service, never()).markAllRead(Mockito.anyLong());
  }
}
