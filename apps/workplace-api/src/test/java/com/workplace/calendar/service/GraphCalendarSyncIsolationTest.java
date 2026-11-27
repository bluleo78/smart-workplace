package com.workplace.calendar.service;

import static com.workplace.jooq.Tables.CALENDAR;
import static com.workplace.jooq.Tables.CALENDAR_EVENT;
import static com.workplace.jooq.Tables.EMAIL_ACCOUNT;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.workplace.calendar.repository.ExternalCalendarRepository;
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
import com.workplace.support.TestFixtures;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicReference;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * Outlook 동기화의 실패 격리 통합 테스트(WP-1710).
 *
 * <p>일정 하나·달력 하나의 DB 오류가 같은 달력의 다른 일정, 다른 달력, 사라진 달력 정리(reconcile)에 번지지 않는지 확인한다. {@link
 * ExternalCalendarRepository} 를 spy 로 감싸 특정 id 에서만 예외를 던지고, {@link GraphCalendarFetcher} spy 로 빠른
 * 길·격리 재시도 중 어느 길을 탔는지 확인한다 — 공유 컨텍스트({@code GraphCalendarSyncTest})를 건드리지 않도록 별도 클래스로 둔다.
 */
class GraphCalendarSyncIsolationTest extends ExternalClientMockedTestBase {

  private static final long TENANT_ID = 1L;

  @Autowired GraphCalendarClient graphCalendarClient;
  @Autowired GraphTokenService graphTokenService;
  @Autowired CalendarSyncService syncService;
  @MockitoSpyBean ExternalCalendarRepository extRepo;
  @MockitoSpyBean GraphCalendarFetcher fetcher;
  @Autowired DSLContext dsl;
  @Autowired EncryptionService encryption;

  private long ownerId;
  private long accountId;
  // 참석자 수집 테스트가 만든 내부 사용자 — tearDown 에서 지운다(WP-1710·WP-1733).
  private final List<Long> extraUserIds = new ArrayList<>();

  @BeforeEach
  void setUp() {
    TenantContext.set(TENANT_ID);
    new TransactionTemplate(txManager)
        .execute(
            status -> {
              ownerId = TestFixtures.createHuman(dsl);
              accountId =
                  dsl.insertInto(EMAIL_ACCOUNT)
                      .set(EMAIL_ACCOUNT.USER_ID, ownerId)
                      .set(EMAIL_ACCOUNT.EMAIL_ADDRESS, "graph-iso-" + ownerId + "@test.local")
                      .set(EMAIL_ACCOUNT.DISPLAY_NAME, "Graph 격리 테스트 계정")
                      .set(EMAIL_ACCOUNT.PROVIDER, "M365_GRAPH")
                      .set(EMAIL_ACCOUNT.OAUTH_REFRESH_TOKEN, encryption.encrypt("RT"))
                      .set(EMAIL_ACCOUNT.OAUTH_TOKEN_EXPIRES_AT, OffsetDateTime.now().plusHours(1))
                      .set(EMAIL_ACCOUNT.OAUTH_ACCESS_TOKEN, encryption.encrypt("FAKE_TOKEN"))
                      .set(EMAIL_ACCOUNT.AI_ENABLED, false)
                      .set(EMAIL_ACCOUNT.TENANT_ID, TENANT_ID)
                      .returning(EMAIL_ACCOUNT.ID)
                      .fetchOne()
                      .getId();
              return null;
            });
    when(graphTokenService.getAccessToken(ownerId, accountId)).thenReturn("tok");
  }

  @AfterEach
  void tearDown() {
    final long uid = ownerId;
    final long aid = accountId;
    cleanupInTenant(
        TENANT_ID,
        () -> {
          dsl.deleteFrom(CALENDAR_EVENT).where(CALENDAR_EVENT.OWNER_ID.eq(uid)).execute();
          dsl.deleteFrom(EMAIL_ACCOUNT).where(EMAIL_ACCOUNT.ID.eq(aid)).execute();
          dsl.execute("DELETE FROM \"user\" WHERE id = ?", uid);
          for (long extra : extraUserIds) {
            dsl.execute("DELETE FROM \"user\" WHERE id = ?", extra);
          }
        });
    TenantContext.clear();
  }

  private static GraphCalendar cal(String id) {
    return new GraphCalendar(id, "달력-" + id, "lightBlue", "", false, true, null);
  }

  /** 지금 기준 days 일 뒤 1시간짜리 일정(동기화 창 안). */
  private static GraphEvent evt(String id, int days) {
    OffsetDateTime start = OffsetDateTime.now(ZoneOffset.UTC).plusDays(days).withNano(0);
    DateTimeFormatter f = DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss");
    return new GraphEvent(
        id,
        "제목-" + id,
        null,
        null,
        new GraphDateTime(start.format(f), "UTC"),
        new GraphDateTime(start.plusHours(1).format(f), "UTC"),
        false,
        null,
        null,
        null,
        false,
        null,
        null,
        null,
        null,
        null);
  }

  private List<String> storedEventIds() {
    return dsl.select(CALENDAR_EVENT.EXTERNAL_ID)
        .from(CALENDAR_EVENT)
        .where(CALENDAR_EVENT.OWNER_ID.eq(ownerId))
        .fetch(CALENDAR_EVENT.EXTERNAL_ID);
  }

  private List<String> storedCalendarIds() {
    return dsl.select(CALENDAR.EXTERNAL_ID)
        .from(CALENDAR)
        .where(CALENDAR.EXTERNAL_ACCOUNT_ID.eq(accountId))
        .fetch(CALENDAR.EXTERNAL_ID);
  }

  /** 지정한 Graph 달력의 일정 조회 결과를 stub 한다. */
  private void stubCalendar(String calId, List<GraphEvent> events) {
    when(graphCalendarClient.listCalendarView(eq("tok"), eq(calId), any(), any()))
        .thenReturn(events);
  }

  /** 지정한 Graph 달력의 upsert 가 항상 DB 오류로 실패하게 한다. */
  private void failCalendarUpsert(String calId) {
    doThrow(new DataIntegrityViolationException("boom"))
        .when(extRepo)
        .upsertExternalCalendar(
            anyLong(), anyLong(), eq(calId), any(), any(), anyBoolean(), anyBoolean());
  }

  /** 저장된 일정의 로컬 id. */
  private Long eventIdOf(String externalId) {
    return dsl.select(CALENDAR_EVENT.ID)
        .from(CALENDAR_EVENT)
        .where(CALENDAR_EVENT.OWNER_ID.eq(ownerId).and(CALENDAR_EVENT.EXTERNAL_ID.eq(externalId)))
        .fetchOne(CALENDAR_EVENT.ID);
  }

  /**
   * e2 의 실제 upsert 를 수행한 뒤 같은 트랜잭션·연결에서 진짜 PostgreSQL 오류(0 나누기)를 일으킨다 — 트랜잭션이 중단 상태가 되므로 세이브포인트 롤백이
   * 없으면 뒤따르는 쿼리가 모두 실패하고, e2 의 부분 upsert 도 되돌려지지 않는다(WP-1710).
   */
  private void failAfterRealUpsert(String externalId) {
    doAnswer(
            inv -> {
              inv.callRealMethod();
              dsl.execute("SELECT 1/0");
              return null;
            })
        .when(extRepo)
        .upsertExternalEvent(anyLong(), anyLong(), eq(externalId), any());
  }

  @Test
  void sync_oneEventFails_otherEventsInSameCalendarAreStored() {
    when(graphCalendarClient.listCalendars("tok")).thenReturn(List.of(cal("c1")));
    stubCalendar("c1", List.of(evt("e1", 1), evt("e2", 2), evt("e3", 3)));
    failAfterRealUpsert("e2");

    syncService.sync(ownerId, accountId);

    // e2 는 새 일정이라 실제 upsert 가 세이브포인트 롤백으로 되돌려져 행이 없어야 한다.
    assertThat(storedEventIds()).containsExactlyInAnyOrder("e1", "e3");
  }

  @Test
  void sync_oneEventFails_existingRowIsKept() {
    when(graphCalendarClient.listCalendars("tok")).thenReturn(List.of(cal("c1")));
    stubCalendar("c1", List.of(evt("e1", 1), evt("e2", 2), evt("e3", 3)));
    syncService.sync(ownerId, accountId);
    Long e2Id = eventIdOf("e2");
    assertThat(storedEventIds()).containsExactlyInAnyOrder("e1", "e2", "e3");

    // 2회차: e2 저장 실패 — 기존 행을 prune 하면 cascade 로 알림·회의록 연결·앱 태그가 사라지므로 같은 id 로 남아야 한다.
    failAfterRealUpsert("e2");
    syncService.sync(ownerId, accountId);

    assertThat(storedEventIds()).containsExactlyInAnyOrder("e1", "e2", "e3");
    Long e2IdAfter = eventIdOf("e2");
    assertThat(e2IdAfter).isEqualTo(e2Id);
  }

  @Test
  void sync_oneCalendarFails_otherCalendarsAreStored() {
    when(graphCalendarClient.listCalendars("tok")).thenReturn(List.of(cal("c1"), cal("c2")));
    stubCalendar("c1", List.of(evt("a1", 1)));
    stubCalendar("c2", List.of(evt("b1", 1)));
    failCalendarUpsert("c1");

    syncService.sync(ownerId, accountId);

    assertThat(storedCalendarIds()).containsExactly("c2");
    assertThat(storedEventIds()).containsExactly("b1");
  }

  @Test
  void sync_persistentCalendarFailure_stillDeletesCalendarsRemovedInOutlook() {
    when(graphCalendarClient.listCalendars("tok"))
        .thenReturn(List.of(cal("cA"), cal("cB"), cal("cC")));
    stubCalendar("cA", List.of(evt("a1", 1)));
    stubCalendar("cB", List.of(evt("b1", 1)));
    stubCalendar("cC", List.of(evt("c1", 1)));
    // 1회차: 정상 동기화
    syncService.sync(ownerId, accountId);
    assertThat(storedCalendarIds()).containsExactlyInAnyOrder("cA", "cB", "cC");

    // 2회차: Outlook 에서 cB 가 지워졌고, cA 는 빠른 길·격리 재시도 모두 실패한다.
    when(graphCalendarClient.listCalendars("tok")).thenReturn(List.of(cal("cA"), cal("cC")));
    failCalendarUpsert("cA");
    syncService.sync(ownerId, accountId);

    // 실패한 cA 는 일정과 함께 남고, 정말 사라진 cB 는 정리돼야 한다(WP-1710).
    assertThat(storedCalendarIds()).containsExactlyInAnyOrder("cA", "cC");
    assertThat(storedEventIds()).containsExactlyInAnyOrder("a1", "c1");
  }

  @Test
  void sync_allCalendarsFail_throws() {
    when(graphCalendarClient.listCalendars("tok")).thenReturn(List.of(cal("c1"), cal("c2")));
    when(graphCalendarClient.listCalendarView(eq("tok"), any(), any(), any()))
        .thenReturn(List.of(evt("x1", 1)));
    doThrow(new DataIntegrityViolationException("boom"))
        .when(extRepo)
        .upsertExternalCalendar(
            anyLong(), anyLong(), any(), any(), any(), anyBoolean(), anyBoolean());

    // 모두 실패하면 성공처럼 보이지 않게 던진다 — CalendarSyncService 가 calendarChanged 를 내지 않는다(WP-1710).
    assertThatThrownBy(() -> syncService.sync(ownerId, accountId))
        .hasCauseInstanceOf(DataIntegrityViolationException.class);
    assertThat(storedCalendarIds()).isEmpty();
  }

  @Test
  void sync_normalCalendar_usesFastPathWithoutPerEventIsolation() {
    when(graphCalendarClient.listCalendars("tok")).thenReturn(List.of(cal("c1")));
    stubCalendar("c1", List.of(evt("e1", 1), evt("e2", 2), evt("e3", 3)));

    syncService.sync(ownerId, accountId);

    // 정상 달력은 세이브포인트 없는 빠른 길 한 번으로 끝나고, 일정별 격리(세이브포인트) 재시도에 들어가지 않는다(WP-1710).
    assertThat(storedEventIds()).containsExactlyInAnyOrder("e1", "e2", "e3");
    verify(fetcher, times(1)).persistCalendar(any(), any(), any(), any(), any(), eq(false));
    verify(fetcher, never()).persistCalendar(any(), any(), any(), any(), any(), eq(true));
  }

  @Test
  void sync_oneEventFails_retriesCalendarWithPerEventIsolation() {
    when(graphCalendarClient.listCalendars("tok")).thenReturn(List.of(cal("c1")));
    stubCalendar("c1", List.of(evt("e1", 1), evt("e2", 2)));
    failAfterRealUpsert("e2");

    syncService.sync(ownerId, accountId);

    // 빠른 길이 실패한 달력만 일정별 격리로 한 번 더 저장한다.
    verify(fetcher, times(1)).persistCalendar(any(), any(), any(), any(), any(), eq(true));
    assertThat(storedEventIds()).containsExactly("e1");
  }

  // ── 참석자 수집(WP-1733) 과 실패 격리(WP-1710) 의 결합 ─────────────────────────────

  /** 고유 이메일의 내부 사용자를 만든다 — 참석자 매칭용. */
  private long createAttendee() {
    String email = "i" + UUID.randomUUID().toString().substring(0, 8) + "@t.local";
    long id =
        new TransactionTemplate(txManager)
            .execute(s -> TestFixtures.createHumanWithEmail(dsl, email));
    extraUserIds.add(id);
    return id;
  }

  /** 사용자 id 의 이메일. */
  private String emailOf(long userId) {
    return new TransactionTemplate(txManager)
        .execute(s -> dsl.fetchValue("SELECT email FROM \"user\" WHERE id = ?", userId))
        .toString();
  }

  /** 소유자가 주최하고 attendeeEmail 을 초대한 1시간 회의 — 시작을 고정해 다시 동기화해도 제목 외에는 같다. */
  private GraphEvent meeting(
      String id, String subject, OffsetDateTime start, String attendeeEmail) {
    DateTimeFormatter f = DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss");
    String ownerEmail = "graph-iso-" + ownerId + "@test.local";
    return new GraphEvent(
        id,
        subject,
        null,
        null,
        new GraphDateTime(start.format(f), "UTC"),
        new GraphDateTime(start.plusHours(1).format(f), "UTC"),
        false,
        null,
        new GraphRecipient(new GraphEmail("주최", ownerEmail)),
        List.of(
            new GraphEventAttendee(
                new GraphEmail("참석자", attendeeEmail),
                new GraphAttendeeStatus("accepted", null),
                "required")),
        false,
        null,
        null,
        null,
        null,
        null);
  }

  /** 동기화를 돌리고 fetcher 가 돌려준 「알릴 내부 참석자」를 꺼낸다. */
  private Set<Long> syncAndCaptureAttendees() {
    AtomicReference<CalendarFetcher.SyncResult> captured = new AtomicReference<>();
    doAnswer(
            inv -> {
              CalendarFetcher.SyncResult r = (CalendarFetcher.SyncResult) inv.callRealMethod();
              captured.set(r);
              return r;
            })
        .when(fetcher)
        .sync(anyLong(), anyLong(), any());
    syncService.sync(ownerId, accountId);
    return captured.get().affectedAttendeeUserIds();
  }

  @Test
  void sync_eventRolledBackToSavepoint_isNotCollectedButOthersAre() {
    long userB = createAttendee();
    long userC = createAttendee();
    OffsetDateTime start =
        OffsetDateTime.now(ZoneOffset.UTC).plusDays(1).truncatedTo(ChronoUnit.HOURS);
    when(graphCalendarClient.listCalendars("tok")).thenReturn(List.of(cal("c1")));
    stubCalendar(
        "c1",
        List.of(
            meeting("e1", "회의1", start, emailOf(userB)),
            meeting("e2", "회의2", start.plusHours(2), emailOf(userC))));
    syncAndCaptureAttendees();

    // 2회차: 둘 다 제목이 바뀌지만 e1 은 저장이 실패해 세이브포인트로 되돌려진다 — e1 의 참석자 B 는 모으면 안 되고, 격리 재시도에서
    // 저장된 e2 의 참석자 C 는 모아야 한다(WP-1710·WP-1733).
    stubCalendar(
        "c1",
        List.of(
            meeting("e1", "회의1(변경)", start, emailOf(userB)),
            meeting("e2", "회의2(변경)", start.plusHours(2), emailOf(userC))));
    failAfterRealUpsert("e1");
    Set<Long> attendees = syncAndCaptureAttendees();

    verify(fetcher, times(1)).persistCalendar(any(), any(), any(), any(), any(), eq(true));
    assertThat(attendees).containsExactly(userC);
  }

  @Test
  void sync_calendarFailedEntirely_contributesNoAttendees() {
    long userB = createAttendee();
    long userC = createAttendee();
    OffsetDateTime start =
        OffsetDateTime.now(ZoneOffset.UTC).plusDays(1).truncatedTo(ChronoUnit.HOURS);
    when(graphCalendarClient.listCalendars("tok")).thenReturn(List.of(cal("c1"), cal("c2")));
    stubCalendar("c1", List.of(meeting("a1", "회의A", start, emailOf(userB))));
    stubCalendar("c2", List.of(meeting("b1", "회의B", start, emailOf(userC))));
    syncAndCaptureAttendees();

    // 2회차: 두 달력 일정 모두 바뀌지만 c1 은 일정 저장(참석자 수집) 뒤 prune 에서 빠른 길·격리 재시도 모두 실패해 통째로 롤백된다 —
    // c1 시도 중 모은 B 는 버려지고, 성공한 c2 의 C 만 남아야 한다(WP-1710·WP-1733).
    stubCalendar("c1", List.of(meeting("a1", "회의A(변경)", start, emailOf(userB))));
    stubCalendar("c2", List.of(meeting("b1", "회의B(변경)", start, emailOf(userC))));
    Long c1Id =
        dsl.select(CALENDAR.ID)
            .from(CALENDAR)
            .where(CALENDAR.EXTERNAL_ACCOUNT_ID.eq(accountId).and(CALENDAR.EXTERNAL_ID.eq("c1")))
            .fetchOne(CALENDAR.ID);
    doThrow(new DataIntegrityViolationException("boom"))
        .when(extRepo)
        .pruneEventsNotIn(eq(c1Id), any(), any(), any(), any());
    Set<Long> attendees = syncAndCaptureAttendees();

    verify(fetcher, times(1)).persistCalendar(any(), any(), any(), any(), any(), eq(true));
    assertThat(attendees).containsExactly(userC);
  }

  // ── 동기화 prune 계약(WP-2156) ───────────────────────────────────────────────────────

  /**
   * pruneEventsNotIn 의 5번째 인자(since)는 수집 이전에 잡은 동기화 시작 시각이어야 한다(WP-2156 Review Focus 1).
   *
   * <p>수집이 끝난 뒤 잡은 값이면 updated_at 가드가 앱과의 경합을 막지 못한다. 수집이 시작한 순간과 동기화 호출 직전 시각을 각각 적어 두고, 그 두 시각
   * 사이에 since 가 놓이는지 모의 호출의 5번째 인자를 캡처해 단언한다 — 벽시계 초 단위 허용폭에 기대지 않아 느린 CI 에서도 흔들리지 않는다.
   */
  @Test
  void sync_passes_collection_start_as_prune_since() {
    when(graphCalendarClient.listCalendars("tok")).thenReturn(List.of(cal("c1")));
    // 수집에 1.5초 지연 — prune 은 수집이 끝난 뒤에 불리므로, 「동기화 시작」과 「prune 시각」이 시간으로 갈린다.
    AtomicReference<OffsetDateTime> collectionStartedAt = new AtomicReference<>();
    when(graphCalendarClient.listCalendarView(eq("tok"), eq("c1"), any(), any()))
        .thenAnswer(
            inv -> {
              collectionStartedAt.set(OffsetDateTime.now(ZoneOffset.UTC));
              Thread.sleep(1500);
              return List.of(evt("e1", 1));
            });
    // 동기화 호출 직전에 기록한 기준 시각 — scope.now() 는 sync() 진입 시점 값이라 이 값보다 뒤다.
    OffsetDateTime beforeSync = OffsetDateTime.now(ZoneOffset.UTC);

    syncService.sync(ownerId, accountId);

    Long c1Id =
        dsl.select(CALENDAR.ID)
            .from(CALENDAR)
            .where(CALENDAR.EXTERNAL_ACCOUNT_ID.eq(accountId).and(CALENDAR.EXTERNAL_ID.eq("c1")))
            .fetchOne(CALENDAR.ID);
    ArgumentCaptor<OffsetDateTime> since = ArgumentCaptor.forClass(OffsetDateTime.class);
    verify(extRepo).pruneEventsNotIn(eq(c1Id), any(), any(), any(), since.capture());

    // (a) 동기화 진입 시각은 수집 시작 이전이다 — 수집이 끝난 뒤(prune 시각) 값을 넘긴 배선은 수집 시작 뒤라 이 경계에 걸린다.
    assertThat(since.getValue()).isBeforeOrEqualTo(collectionStartedAt.get());
    // (b) 동기화 윈도우 시작(from) 같은 이전 시각이 아니다 — 동기화 호출 직전에 기록한 beforeSync 이후다.
    assertThat(since.getValue()).isAfterOrEqualTo(beforeSync);
  }
}
