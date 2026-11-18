package com.workplace.calendar.service;

import static com.workplace.jooq.Tables.CALENDAR_EVENT;
import static com.workplace.jooq.Tables.EMAIL_ACCOUNT;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.clearInvocations;
import static org.mockito.Mockito.when;

import com.workplace.global.realtime.SseRegistry;
import com.workplace.global.security.EncryptionService;
import com.workplace.global.tenant.TenantContext;
import com.workplace.mail.outbound.GraphCalendarClient;
import com.workplace.mail.outbound.GraphCalendarClient.GraphAttendeeStatus;
import com.workplace.mail.outbound.GraphCalendarClient.GraphCalendar;
import com.workplace.mail.outbound.GraphCalendarClient.GraphDateTime;
import com.workplace.mail.outbound.GraphCalendarClient.GraphEmail;
import com.workplace.mail.outbound.GraphCalendarClient.GraphEvent;
import com.workplace.mail.outbound.GraphCalendarClient.GraphEventAttendee;
import com.workplace.mail.outbound.GraphCalendarClient.GraphRecipient;
import com.workplace.mail.service.GraphTokenService;
import com.workplace.support.ExternalClientMockedTestBase;
import com.workplace.support.ResourceChangedCapture;
import com.workplace.support.ResourceChangedCapture.Captured;
import com.workplace.support.TestFixtures;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * WP-1733 — Outlook(Graph) 동기화가 실제로 바꾼 일정의 내부 참석자에게도 캘린더 변경(resource.changed) 을 보내는지 검증한다.
 *
 * <p>같은 회의는 교차 출처 중복 제거로 다른 내부 참석자 화면에도 보이므로, 소유자 A 의 동기화가 그 회의를 생성·변경·삭제하면 참석자 B 의 열린 캘린더도 갱신돼야
 * 한다. 바뀐 것이 없는 동기화는 B 에게 보내지 않는다(소유자는 늘 받는다). AFTER_COMMIT 발화를 위해 @Transactional 을 붙이지 않는다.
 */
@DisplayName("Graph 동기화 → 바뀐 일정의 내부 참석자에게 캘린더 변경 알림")
class GraphCalendarSyncAttendeeNotifyTest extends ExternalClientMockedTestBase {

  @Autowired GraphCalendarClient graphCalendarClient;
  @Autowired GraphTokenService graphTokenService;
  @Autowired SseRegistry registry;
  @Autowired CalendarSyncService syncService;
  @Autowired DSLContext dsl;
  @Autowired EncryptionService encryption;

  private static final long TENANT_ID = 1L;

  /** Graph calendarView 의 오프셋 없는 날짜시간 형식. */
  private static final DateTimeFormatter GRAPH_DT =
      DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss.0000000");

  private long ownerId;
  private long accountId;
  private String ownerEmail;
  private long attendeeId;
  private String attendeeEmail;

  /** 일정 시작 — 동기화 창(지금-1개월 ~ 지금+3개월) 안이어야 prune 대상이 된다. 고정 날짜는 시간이 지나면 창 밖으로 빠진다. */
  private OffsetDateTime start;

  @BeforeEach
  void setUp() {
    TenantContext.set(TENANT_ID);
    start = OffsetDateTime.now(ZoneOffset.UTC).plusDays(1).truncatedTo(ChronoUnit.HOURS);
    // 다른 테스트가 남긴 사용자와 이메일이 겹쳐 엉뚱한 사람으로 매칭되지 않게 고유 주소를 쓴다(username 이 주소에서 나와 50자 제한 — 짧게).
    attendeeEmail = "b" + UUID.randomUUID().toString().substring(0, 8) + "@t.local";
    new TransactionTemplate(txManager)
        .executeWithoutResult(
            s -> {
              ownerId = TestFixtures.createHuman(dsl);
              ownerEmail = "graph-notify-" + ownerId + "@test.local";
              accountId = seedGraphAccount(ownerId, ownerEmail);
              attendeeId = TestFixtures.createHumanWithEmail(dsl, attendeeEmail);
            });
    when(graphTokenService.getAccessToken(ownerId, accountId)).thenReturn("tok");
    when(graphCalendarClient.listCalendars("tok"))
        .thenReturn(List.of(new GraphCalendar("gcal", "업무", "lightBlue", "", true, true, null)));
  }

  @AfterEach
  void tearDown() {
    final long uid = ownerId;
    final long aid = accountId;
    final long bid = attendeeId;
    cleanupInTenant(
        TENANT_ID,
        () -> {
          // 일정을 먼저 지워 참석자 행이 cascade 로 사라진 뒤 사람을 지운다.
          dsl.deleteFrom(CALENDAR_EVENT).where(CALENDAR_EVENT.OWNER_ID.eq(uid)).execute();
          dsl.deleteFrom(EMAIL_ACCOUNT).where(EMAIL_ACCOUNT.ID.eq(aid)).execute();
          dsl.execute("DELETE FROM \"user\" WHERE id IN (?, ?)", uid, bid);
        });
    TenantContext.clear();
  }

  @Test
  @DisplayName("동기화가 일정을 바꾸면 내부 참석자에게도 알린다")
  void sync_changedEvent_notifiesInternalAttendee() {
    stubEvents(meeting("주간 회의", List.of(attendeeEmail)));
    syncService.sync(ownerId, accountId);

    clearInvocations(registry);
    stubEvents(meeting("주간 회의(시간 변경)", List.of(attendeeEmail)));
    syncService.sync(ownerId, accountId);

    assertThat(syncChanged().recipients()).containsExactlyInAnyOrder(ownerId, attendeeId);
  }

  @Test
  @DisplayName("동기화가 일정을 지우면(prune) 삭제 전 참석자에게도 알린다")
  void sync_prunedEvent_notifiesInternalAttendee() {
    stubEvents(meeting("주간 회의", List.of(attendeeEmail)));
    syncService.sync(ownerId, accountId);

    clearInvocations(registry);
    // Outlook 에서 회의가 사라짐 — 달력은 그대로, 일정만 없다.
    stubEvents();
    syncService.sync(ownerId, accountId);

    assertThat(eventCount()).isZero();
    assertThat(syncChanged().recipients()).containsExactlyInAnyOrder(ownerId, attendeeId);
  }

  @Test
  @DisplayName("참석자에서 빠진 사람에게도 알린다(변경 전 명단 포함)")
  void sync_removedAttendee_notifiesRemovedUser() {
    stubEvents(meeting("주간 회의", List.of(attendeeEmail)));
    syncService.sync(ownerId, accountId);

    clearInvocations(registry);
    stubEvents(meeting("주간 회의", List.of()));
    syncService.sync(ownerId, accountId);

    assertThat(syncChanged().recipients()).containsExactlyInAnyOrder(ownerId, attendeeId);
  }

  @Test
  @DisplayName("바뀐 것이 없는 동기화는 참석자에게 보내지 않는다(소유자는 받는다)")
  void sync_unchanged_notifiesOwnerOnly() {
    stubEvents(meeting("주간 회의", List.of(attendeeEmail)));
    syncService.sync(ownerId, accountId);
    // 첫 동기화는 일정을 새로 만들었으니 참석자도 받는다 — 아래 「안 받는다」가 원래부터 안 보내서 통과하는 것이 아님을 확인.
    assertThat(syncChanged().recipients()).containsExactlyInAnyOrder(ownerId, attendeeId);

    clearInvocations(registry);
    syncService.sync(ownerId, accountId);

    assertThat(syncChanged().recipients()).containsExactly(ownerId);
  }

  /** 이번 동기화가 발행한 calendar/updated resource.changed. */
  private Captured syncChanged() {
    return ResourceChangedCapture.capture(registry, "calendar", "updated");
  }

  private void stubEvents(GraphEvent... events) {
    when(graphCalendarClient.listCalendarView(eq("tok"), eq("gcal"), any(), any()))
        .thenReturn(List.of(events));
  }

  /** 소유자가 주최하고 attendeeEmails 를 초대한 1시간짜리 회의(외부 id 고정 — 같은 일정을 다시 동기화한다). */
  private GraphEvent meeting(String subject, List<String> attendeeEmails) {
    List<GraphEventAttendee> attendees =
        attendeeEmails.stream()
            .map(
                e ->
                    new GraphEventAttendee(
                        new GraphEmail("참석자", e),
                        new GraphAttendeeStatus("accepted", null),
                        "required"))
            .toList();
    return new GraphEvent(
        "evt-1733",
        subject,
        null,
        null,
        new GraphDateTime(start.format(GRAPH_DT), "UTC"),
        new GraphDateTime(start.plusHours(1).format(GRAPH_DT), "UTC"),
        false,
        null,
        new GraphRecipient(new GraphEmail("주최", ownerEmail)),
        attendees,
        false,
        "ical-1733",
        null,
        null,
        null,
        null);
  }

  private int eventCount() {
    return new TransactionTemplate(txManager)
        .execute(s -> dsl.fetchCount(CALENDAR_EVENT, CALENDAR_EVENT.OWNER_ID.eq(ownerId)));
  }

  /** M365_GRAPH email_account 픽스처 — calendar.external_account_id FK 충족용. */
  private long seedGraphAccount(long userId, String email) {
    return dsl.insertInto(EMAIL_ACCOUNT)
        .set(EMAIL_ACCOUNT.USER_ID, userId)
        .set(EMAIL_ACCOUNT.EMAIL_ADDRESS, email)
        .set(EMAIL_ACCOUNT.DISPLAY_NAME, "Graph 알림 테스트 계정")
        .set(EMAIL_ACCOUNT.PROVIDER, "M365_GRAPH")
        .set(EMAIL_ACCOUNT.OAUTH_REFRESH_TOKEN, encryption.encrypt("RT"))
        .set(EMAIL_ACCOUNT.OAUTH_TOKEN_EXPIRES_AT, OffsetDateTime.now().plusHours(1))
        .set(EMAIL_ACCOUNT.OAUTH_ACCESS_TOKEN, encryption.encrypt("FAKE_TOKEN"))
        .set(EMAIL_ACCOUNT.AI_ENABLED, false)
        .set(EMAIL_ACCOUNT.TENANT_ID, TENANT_ID)
        .returning(EMAIL_ACCOUNT.ID)
        .fetchOne()
        .getId();
  }
}
