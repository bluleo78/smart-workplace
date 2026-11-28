package com.workplace.calendar.service;

import static com.workplace.jooq.Tables.CALENDAR;
import static com.workplace.jooq.Tables.CALENDAR_EVENT;
import static com.workplace.jooq.Tables.CALENDAR_EVENT_TAG;
import static com.workplace.jooq.Tables.CALENDAR_USER_SETTING;
import static com.workplace.jooq.Tables.EMAIL_ACCOUNT;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.workplace.calendar.dto.CalendarEventRequest;
import com.workplace.calendar.dto.CalendarEventResponse;
import com.workplace.calendar.dto.CalendarTagRequest;
import com.workplace.calendar.exception.ExternalCalendarWriteException;
import com.workplace.calendar.exception.ExternalCalendarWriteInTransactionException;
import com.workplace.calendar.exception.ExternalEventTagNotSupportedException;
import com.workplace.calendar.exception.RecurringNotSupportedOnExternalCalendarException;
import com.workplace.calendar.repository.CalendarRepository;
import com.workplace.global.security.EncryptionService;
import com.workplace.global.tenant.TenantContext;
import com.workplace.mail.outbound.GraphCalendarClient.GraphEventWrite;
import com.workplace.mail.service.GraphTokenService;
import com.workplace.notify.outbound.NotificationDispatcher;
import com.workplace.support.ExternalClientMockedTestBase;
import com.workplace.support.TestFixtures;
import com.workplace.user.dto.UserKind;
import java.time.OffsetDateTime;
import java.util.List;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.mockito.InOrder;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * create/update/delete write-through 통합 테스트 — CalendarTransport·GraphTokenService 를 모킹한다.
 * NotificationDispatcher 도 모킹해 AFTER_COMMIT @Async 알림 스레드가 테스트 정리 시 FK 경합을 유발하지 않도록 한다.
 */
class CalendarEventWriteThroughTest extends ExternalClientMockedTestBase {

  @MockitoBean CalendarTransport calendarTransport;
  @Autowired GraphTokenService graphTokenService;
  @MockitoBean NotificationDispatcher notificationDispatcher;

  @Autowired CalendarEventService eventService;
  @Autowired CalendarRepository calendarRepo;
  @Autowired DSLContext dsl;
  @Autowired com.workplace.calendar.repository.CalendarEventExceptionRepository exceptionRepo;
  @Autowired EncryptionService encryption;

  private static final long TENANT_ID = 1L;
  private long ownerId;
  private long accountId;
  private long extCalId;

  @BeforeEach
  void setUp() {
    TenantContext.set(TENANT_ID);
    new TransactionTemplate(txManager)
        .execute(
            s -> {
              ownerId = TestFixtures.createHuman(dsl);
              accountId =
                  dsl.insertInto(EMAIL_ACCOUNT)
                      .set(EMAIL_ACCOUNT.USER_ID, ownerId)
                      .set(EMAIL_ACCOUNT.EMAIL_ADDRESS, ownerId + "@iacloud.kr")
                      .set(EMAIL_ACCOUNT.PROVIDER, "M365_GRAPH")
                      .set(EMAIL_ACCOUNT.OAUTH_REFRESH_TOKEN, encryption.encrypt("RT"))
                      .set(EMAIL_ACCOUNT.OAUTH_ACCESS_TOKEN, encryption.encrypt("AT"))
                      .set(EMAIL_ACCOUNT.OAUTH_TOKEN_EXPIRES_AT, OffsetDateTime.now().plusHours(1))
                      .set(EMAIL_ACCOUNT.AI_ENABLED, false)
                      .set(EMAIL_ACCOUNT.TENANT_ID, TENANT_ID)
                      .returning(EMAIL_ACCOUNT.ID)
                      .fetchOne()
                      .getId();
              // 외부 쓰기 캘린더 컨테이너(is_read_only=false)
              extCalId =
                  dsl.insertInto(CALENDAR)
                      .set(CALENDAR.OWNER_ID, ownerId)
                      .set(CALENDAR.NAME, "업무")
                      .set(CALENDAR.COLOR, "blue")
                      .set(CALENDAR.IS_DEFAULT, false)
                      .set(CALENDAR.POSITION, 0)
                      .set(CALENDAR.EXTERNAL_ACCOUNT_ID, accountId)
                      .set(CALENDAR.EXTERNAL_ID, "gcal-write")
                      .set(CALENDAR.IS_READ_ONLY, false)
                      .set(CALENDAR.TENANT_ID, TENANT_ID)
                      .returning(CALENDAR.ID)
                      .fetchOne()
                      .getId();
              return null;
            });
    when(calendarTransport.provider()).thenReturn(com.workplace.mail.dto.MailProvider.M365_GRAPH);
  }

  @AfterEach
  void tearDown() {
    final long uid = ownerId, aid = accountId;
    cleanupInTenant(
        TENANT_ID,
        () -> {
          dsl.deleteFrom(CALENDAR_EVENT).where(CALENDAR_EVENT.OWNER_ID.eq(uid)).execute();
          dsl.deleteFrom(CALENDAR).where(CALENDAR.OWNER_ID.eq(uid)).execute();
          dsl.deleteFrom(EMAIL_ACCOUNT).where(EMAIL_ACCOUNT.ID.eq(aid)).execute();
          dsl.execute("DELETE FROM \"user\" WHERE id = ?", uid);
        });
    TenantContext.clear();
  }

  private CalendarEventRequest req(Long calId, String rrule) {
    OffsetDateTime s = OffsetDateTime.parse("2026-07-10T09:00:00Z");
    return new CalendarEventRequest(
        "회의", "본문", s, s.plusHours(1), false, "회의실", null, null, rrule, null, calId);
  }

  /** 종일 일정 요청 — startsAt/endsAt 은 저장 instant(현지 자정의 UTC 표현)를 그대로 받는다. */
  private CalendarEventRequest allDayReq(Long calId, String startUtc, String endUtc) {
    return new CalendarEventRequest(
        "종일",
        "본문",
        OffsetDateTime.parse(startUtc),
        OffsetDateTime.parse(endUtc),
        true,
        null,
        null,
        null,
        null,
        null,
        calId);
  }

  @Test
  void create_into_external_calendar_pushes_to_graph_and_stores_externalId() {
    when(calendarTransport.createEvent(eq(ownerId), any(), eq("gcal-write"), any()))
        .thenReturn("graph-evt-1");

    CalendarEventResponse created = eventService.create(ownerId, req(extCalId, null));

    verify(calendarTransport).createEvent(eq(ownerId), any(), eq("gcal-write"), any());
    String stored =
        new TransactionTemplate(txManager)
            .execute(
                s ->
                    dsl.select(CALENDAR_EVENT.EXTERNAL_ID)
                        .from(CALENDAR_EVENT)
                        .where(CALENDAR_EVENT.ID.eq(created.id()))
                        .fetchOne(CALENDAR_EVENT.EXTERNAL_ID));
    assertThat(stored).isEqualTo("graph-evt-1");
  }

  @Test
  void create_recurring_into_external_calendar_rejected_422() {
    assertThatThrownBy(() -> eventService.create(ownerId, req(extCalId, "FREQ=WEEKLY")))
        .isInstanceOf(RecurringNotSupportedOnExternalCalendarException.class);
    verify(calendarTransport, never()).createEvent(anyLong(), any(), any(), any());
  }

  @Test
  void create_into_local_calendar_does_not_call_transport() {
    long localCal = calendarRepo.insert(ownerId, "개인", "green", true, 1);
    eventService.create(ownerId, req(localCal, null));
    verify(calendarTransport, never()).createEvent(anyLong(), any(), any(), any());
  }

  /**
   * 가드(#502, 후속 #548): 호출자의 ambient 트랜잭션(AI·채팅 confirm 경로) 안에서 외부 쓰기 캘린더로 create 진입 시 →
   * ExternalCalendarWriteInTransactionException(409). Graph HTTP 미호출 + 로컬 행 미생성을 함께 검증한다.
   */
  @Test
  void create_into_external_calendar_within_ambient_tx_rejected_and_no_graph_no_local() {
    when(calendarTransport.createEvent(eq(ownerId), any(), eq("gcal-write"), any()))
        .thenReturn("graph-evt-x");

    // create 자체를 활성 트랜잭션으로 감싼다(REST 비-tx 경로와 달리 AI·채팅 confirm 의 @Transactional 을 모사).
    assertThatThrownBy(
            () ->
                new TransactionTemplate(txManager)
                    .execute(s -> eventService.create(ownerId, req(extCalId, null))))
        .isInstanceOf(ExternalCalendarWriteInTransactionException.class);

    // Graph 미호출.
    verify(calendarTransport, never()).createEvent(anyLong(), any(), any(), any());

    // 로컬 행 미생성(TenantContext tx 안 카운트 — 바깥 raw read 는 GUC 부재로 거짓 0).
    int rows =
        new TransactionTemplate(txManager)
            .execute(
                s ->
                    dsl.fetchCount(
                        dsl.selectFrom(CALENDAR_EVENT).where(CALENDAR_EVENT.OWNER_ID.eq(ownerId))));
    assertThat(rows).isZero();
  }

  /** 새 일정 기본 캘린더 설정(WP-2169)을 외부 쓰기 캘린더로 시드한다(테넌트 GUC 가 서는 tx 안). */
  private void preferExternalCalendar() {
    new TransactionTemplate(txManager)
        .executeWithoutResult(
            s ->
                dsl.insertInto(CALENDAR_USER_SETTING)
                    .set(CALENDAR_USER_SETTING.USER_ID, ownerId)
                    .set(CALENDAR_USER_SETTING.PREFERRED_CALENDAR_ID, extCalId)
                    .execute());
  }

  /**
   * WP-2169: 기본 캘린더가 외부(M365) 쓰기 캘린더이고 트랜잭션 밖(REST·외부 MCP create_event)에서 캘린더를 생략해 만들면 그 외부 캘린더에
   * Graph 로 만들어진다.
   */
  @Test
  void create_without_calendar_outside_tx_follows_preferred_external_calendar() {
    preferExternalCalendar();
    when(calendarTransport.createEvent(eq(ownerId), any(), eq("gcal-write"), any()))
        .thenReturn("graph-pref-1");

    CalendarEventResponse created = eventService.create(ownerId, req(null, null));

    assertThat(created.calendarId()).isEqualTo(extCalId);
    verify(calendarTransport).createEvent(eq(ownerId), any(), eq("gcal-write"), any());
  }

  /**
   * WP-2169: 같은 기본 캘린더라도 호출자 트랜잭션 안(앱 안 AI 확인 카드 승인)에서는 Graph 쓰기가 막혀 있으므로(#548) Works 캘린더에 만든다 —
   * 예외(ExternalCalendarWriteInTransactionException) 없이, Graph 호출 없이.
   */
  @Test
  void create_without_calendar_within_ambient_tx_lands_in_works_calendar() {
    preferExternalCalendar();

    CalendarEventResponse created =
        new TransactionTemplate(txManager)
            .execute(s -> eventService.create(ownerId, req(null, null)));

    long works =
        new TransactionTemplate(txManager)
            .execute(s -> calendarRepo.findDefaultId(ownerId).orElseThrow());
    assertThat(created.calendarId()).isEqualTo(works).isNotEqualTo(extCalId);
    verify(calendarTransport, never()).createEvent(anyLong(), any(), any(), any());
  }

  /**
   * WP-2169: 기본 캘린더가 외부(M365)여도 반복 일정(RRULE)을 캘린더 생략·트랜잭션 밖으로 만들면 Works 캘린더에 만든다. 외부 캘린더는 반복 일정을
   * 거절하므로(RecurringNotSupportedOnExternalCalendarException) 기본값이 외부로 풀리면 회귀가 된다 — epic WP-2168 결정:
   * 「반복이면 Works 캘린더」. 예외 없이, Graph 호출 없이.
   */
  @Test
  void create_recurring_without_calendar_outside_tx_lands_in_works_calendar() {
    preferExternalCalendar();

    CalendarEventResponse created = eventService.create(ownerId, req(null, "FREQ=WEEKLY"));

    long works =
        new TransactionTemplate(txManager)
            .execute(s -> calendarRepo.findDefaultId(ownerId).orElseThrow());
    assertThat(created.calendarId()).isEqualTo(works).isNotEqualTo(extCalId);
    verify(calendarTransport, never()).createEvent(anyLong(), any(), any(), any());
  }

  /** Graph 쓰기 실패(502) → 예외 전파 + 로컬 행 미생성(HTTP 단계가 persist 트랜잭션 진입 전에 실패). */
  @Test
  void create_graph_failure_502_persists_no_local_row() {
    when(calendarTransport.createEvent(eq(ownerId), any(), eq("gcal-write"), any()))
        .thenThrow(new ExternalCalendarWriteException("graph 쓰기 실패", new RuntimeException("boom")));

    assertThatThrownBy(() -> eventService.create(ownerId, req(extCalId, null)))
        .isInstanceOf(ExternalCalendarWriteException.class);

    // 바깥 트랜잭션 밖 raw read 는 GUC 부재로 거짓 0 → TenantContext(setUp 유지) tx 안에서 카운트.
    int rows =
        new TransactionTemplate(txManager)
            .execute(
                s ->
                    dsl.fetchCount(
                        dsl.selectFrom(CALENDAR_EVENT).where(CALENDAR_EVENT.OWNER_ID.eq(ownerId))));
    assertThat(rows).isZero();
  }

  /**
   * 종일 일정(KST 사용자 생성) Graph 페이로드 — 저장 instant 가 비-자정({@code 15:00Z})이라도 +12h 반올림으로 의도한 캘린더 날짜를 복원해
   * 자정(00:00:00) UTC 로 전송한다. KST 종일 "2026-07-10" → 저장 start {@code 2026-07-09T15:00:00Z} / end
   * {@code 2026-07-10T15:00:00Z}(half-open 다음날) → Graph start {@code 2026-07-10T00:00:00} / end
   * {@code 2026-07-11T00:00:00}.
   */
  @Test
  void create_allday_kst_recovers_calendar_date_to_utc_midnight() {
    when(calendarTransport.createEvent(eq(ownerId), any(), eq("gcal-write"), any()))
        .thenReturn("graph-allday-1");

    eventService.create(
        ownerId, allDayReq(extCalId, "2026-07-09T15:00:00Z", "2026-07-10T15:00:00Z"));

    ArgumentCaptor<GraphEventWrite> captor = ArgumentCaptor.forClass(GraphEventWrite.class);
    verify(calendarTransport).createEvent(eq(ownerId), any(), eq("gcal-write"), captor.capture());
    GraphEventWrite w = captor.getValue();
    assertThat(w.isAllDay()).isTrue();
    assertThat(w.start().dateTime()).isEqualTo("2026-07-10T00:00:00");
    assertThat(w.start().timeZone()).isEqualTo("UTC");
    assertThat(w.end().dateTime()).isEqualTo("2026-07-11T00:00:00");
    assertThat(w.end().timeZone()).isEqualTo("UTC");
  }

  /**
   * 종일 일정(이미 UTC 자정 — 동기화 출신 등) Graph 페이로드 — {@code 00:00Z + 12h} = 같은 날 정오 → 날짜 불변. start {@code
   * 2026-07-10T00:00:00Z} / end {@code 2026-07-11T00:00:00Z} → Graph start {@code
   * 2026-07-10T00:00:00} / end {@code 2026-07-11T00:00:00}.
   */
  @Test
  void create_allday_utc_midnight_unchanged() {
    when(calendarTransport.createEvent(eq(ownerId), any(), eq("gcal-write"), any()))
        .thenReturn("graph-allday-2");

    eventService.create(
        ownerId, allDayReq(extCalId, "2026-07-10T00:00:00Z", "2026-07-11T00:00:00Z"));

    ArgumentCaptor<GraphEventWrite> captor = ArgumentCaptor.forClass(GraphEventWrite.class);
    verify(calendarTransport).createEvent(eq(ownerId), any(), eq("gcal-write"), captor.capture());
    GraphEventWrite w = captor.getValue();
    assertThat(w.isAllDay()).isTrue();
    assertThat(w.start().dateTime()).isEqualTo("2026-07-10T00:00:00");
    assertThat(w.end().dateTime()).isEqualTo("2026-07-11T00:00:00");
  }

  /** 시각 일정(allDay=false)은 영향 없음 — instant 의 LocalDateTime 그대로(초 0 은 생략) 전송. */
  @Test
  void create_timed_event_payload_unaffected() {
    when(calendarTransport.createEvent(eq(ownerId), any(), eq("gcal-write"), any()))
        .thenReturn("graph-timed-1");

    eventService.create(ownerId, req(extCalId, null));

    ArgumentCaptor<GraphEventWrite> captor = ArgumentCaptor.forClass(GraphEventWrite.class);
    verify(calendarTransport).createEvent(eq(ownerId), any(), eq("gcal-write"), captor.capture());
    GraphEventWrite w = captor.getValue();
    assertThat(w.isAllDay()).isFalse();
    assertThat(w.start().dateTime()).isEqualTo("2026-07-10T09:00");
    assertThat(w.start().timeZone()).isEqualTo("UTC");
    assertThat(w.end().dateTime()).isEqualTo("2026-07-10T10:00");
  }

  // ── update write-through (Task 8) ──────────────────────────────────────────

  /** 외부 동기화 일정 수정 → Graph PATCH(updateEvent) 호출 + 로컬 title 반영. */
  @Test
  void update_external_event_pushes_patch_to_graph() {
    when(calendarTransport.createEvent(eq(ownerId), any(), eq("gcal-write"), any()))
        .thenReturn("graph-evt-2");
    CalendarEventResponse created = eventService.create(ownerId, req(extCalId, null));

    CalendarEventRequest edit =
        new CalendarEventRequest(
            "변경된제목",
            "본문",
            OffsetDateTime.parse("2026-07-10T09:00:00Z"),
            OffsetDateTime.parse("2026-07-10T10:00:00Z"),
            false,
            "회의실",
            null,
            null,
            null,
            null,
            extCalId);
    CalendarEventResponse updated =
        eventService.update(
            ownerId, created.id(), edit, com.workplace.calendar.dto.EditScope.ALL, null);

    verify(calendarTransport).updateEvent(eq(ownerId), any(), eq("graph-evt-2"), any());
    assertThat(updated.title()).isEqualTo("변경된제목");
  }

  /**
   * 설명을 건드리지 않은 수정(시간만 변경)은 Graph PATCH 에 본문을 싣지 않는다(WP-709 리뷰) — 동기화된 설명은 HTML 초대문의 텍스트 변환본이라 되돌려
   * 보내면 Outlook 의 서식 있는 초대문이 덮인다. 설명을 실제로 바꾼 수정은 본문을 보낸다.
   */
  @Test
  void update_external_event_omits_body_unless_description_changed() {
    when(calendarTransport.createEvent(eq(ownerId), any(), eq("gcal-write"), any()))
        .thenReturn("graph-evt-body");
    CalendarEventResponse created = eventService.create(ownerId, req(extCalId, null));

    // ① 설명 그대로("본문"), 시간만 변경
    eventService.update(
        ownerId,
        created.id(),
        editWith("본문", "2026-07-10T10:00:00Z", "2026-07-10T11:00:00Z"),
        com.workplace.calendar.dto.EditScope.ALL,
        null);
    // ② 설명 변경
    eventService.update(
        ownerId,
        created.id(),
        editWith("새 본문", "2026-07-10T10:00:00Z", "2026-07-10T11:00:00Z"),
        com.workplace.calendar.dto.EditScope.ALL,
        null);

    ArgumentCaptor<GraphEventWrite> captor = ArgumentCaptor.forClass(GraphEventWrite.class);
    verify(calendarTransport, org.mockito.Mockito.times(2))
        .updateEvent(eq(ownerId), any(), eq("graph-evt-body"), captor.capture());
    assertThat(captor.getAllValues().get(0).body()).isNull();
    assertThat(captor.getAllValues().get(1).body()).isNotNull();
    assertThat(captor.getAllValues().get(1).body().content()).isEqualTo("새 본문");
  }

  private CalendarEventRequest editWith(String description, String startUtc, String endUtc) {
    return new CalendarEventRequest(
        "회의",
        description,
        OffsetDateTime.parse(startUtc),
        OffsetDateTime.parse(endUtc),
        false,
        "회의실",
        null,
        null,
        null,
        null,
        extCalId);
  }

  /** 외부 동기화 일정을 다른(로컬) 캘린더로 이동 시도 → 422, Graph PATCH 미호출, 로컬 소속 캘린더 불변. */
  @Test
  void update_external_event_move_to_other_calendar_is_rejected_422() {
    when(calendarTransport.createEvent(eq(ownerId), any(), eq("gcal-write"), any()))
        .thenReturn("graph-evt-3");
    CalendarEventResponse created = eventService.create(ownerId, req(extCalId, null));

    long otherCal = calendarRepo.insert(ownerId, "다른", "red", true, 2);
    CalendarEventRequest move =
        new CalendarEventRequest(
            "이동",
            null,
            OffsetDateTime.parse("2026-07-10T09:00:00Z"),
            OffsetDateTime.parse("2026-07-10T10:00:00Z"),
            false,
            null,
            null,
            null,
            null,
            null,
            otherCal);

    assertThatThrownBy(
            () ->
                eventService.update(
                    ownerId, created.id(), move, com.workplace.calendar.dto.EditScope.ALL, null))
        .isInstanceOf(
            com.workplace.calendar.exception.ExternalEventMoveNotSupportedException.class);
    verify(calendarTransport, never()).updateEvent(anyLong(), any(), any(), any());
    // 로컬 행의 소속 캘린더는 변경되지 않아야 한다.
    assertThat(eventService.get(ownerId, created.id()).calendarId()).isEqualTo(extCalId);
  }

  /** 화면이 본 뒤 바뀐 외부 일정(expectedUpdatedAt 불일치)은 409 로 막고 Graph PATCH 를 부르지 않는다(WP-1920). */
  @Test
  void update_external_event_with_stale_expectedUpdatedAt_is_409_and_skips_graph() {
    when(calendarTransport.createEvent(eq(ownerId), any(), eq("gcal-write"), any()))
        .thenReturn("graph-evt-conflict");
    CalendarEventResponse created = eventService.create(ownerId, req(extCalId, null));
    OffsetDateTime stale = created.updatedAt().minusSeconds(5);

    assertThatThrownBy(
            () ->
                eventService.update(
                    ownerId,
                    created.id(),
                    req(extCalId, null),
                    com.workplace.calendar.dto.EditScope.ALL,
                    null,
                    stale))
        .isInstanceOf(com.workplace.calendar.exception.CalendarEventConflictException.class);
    verify(calendarTransport, never()).updateEvent(anyLong(), any(), any(), any());
  }

  /** 외부 동기화 일정에 반복 전환 시도 → 422(외부는 단일 일정만), Graph PATCH 미호출. */
  @Test
  void update_external_event_to_recurring_is_rejected_422() {
    when(calendarTransport.createEvent(eq(ownerId), any(), eq("gcal-write"), any()))
        .thenReturn("graph-evt-4");
    CalendarEventResponse created = eventService.create(ownerId, req(extCalId, null));

    CalendarEventRequest recurring = req(extCalId, "FREQ=WEEKLY");
    assertThatThrownBy(
            () ->
                eventService.update(
                    ownerId,
                    created.id(),
                    recurring,
                    com.workplace.calendar.dto.EditScope.ALL,
                    null))
        .isInstanceOf(RecurringNotSupportedOnExternalCalendarException.class);
    verify(calendarTransport, never()).updateEvent(anyLong(), any(), any(), any());
  }

  /** Graph PATCH 실패(502) → 예외 전파 + 로컬 행 미변경(HTTP 가 persist 트랜잭션 진입 전에 실패). */
  @Test
  void update_external_event_graph_failure_502_keeps_local_unchanged() {
    when(calendarTransport.createEvent(eq(ownerId), any(), eq("gcal-write"), any()))
        .thenReturn("graph-evt-5");
    CalendarEventResponse created = eventService.create(ownerId, req(extCalId, null));
    org.mockito.Mockito.doThrow(
            new ExternalCalendarWriteException("graph 수정 실패", new RuntimeException("boom")))
        .when(calendarTransport)
        .updateEvent(eq(ownerId), any(), eq("graph-evt-5"), any());

    CalendarEventRequest edit =
        new CalendarEventRequest(
            "변경시도",
            "본문",
            OffsetDateTime.parse("2026-07-10T09:00:00Z"),
            OffsetDateTime.parse("2026-07-10T10:00:00Z"),
            false,
            null,
            null,
            null,
            null,
            null,
            extCalId);

    assertThatThrownBy(
            () ->
                eventService.update(
                    ownerId, created.id(), edit, com.workplace.calendar.dto.EditScope.ALL, null))
        .isInstanceOf(ExternalCalendarWriteException.class);
    // 로컬 행의 제목은 원래 값("회의")을 유지해야 한다.
    assertThat(eventService.get(ownerId, created.id()).title()).isEqualTo("회의");
  }

  /**
   * 가드(#502, 후속 #548): 호출자의 ambient 트랜잭션(AI·채팅 confirm 경로) 안에서 외부 일정 수정 진입 시 →
   * ExternalCalendarWriteInTransactionException(409). Graph PATCH 미호출 + 로컬 제목 불변을 함께 검증한다.
   */
  @Test
  void update_external_event_within_ambient_tx_rejected_and_no_graph_no_local() {
    when(calendarTransport.createEvent(eq(ownerId), any(), eq("gcal-write"), any()))
        .thenReturn("graph-evt-6");
    CalendarEventResponse created = eventService.create(ownerId, req(extCalId, null));

    CalendarEventRequest edit =
        new CalendarEventRequest(
            "tx내수정",
            "본문",
            OffsetDateTime.parse("2026-07-10T09:00:00Z"),
            OffsetDateTime.parse("2026-07-10T10:00:00Z"),
            false,
            null,
            null,
            null,
            null,
            null,
            extCalId);

    assertThatThrownBy(
            () ->
                new TransactionTemplate(txManager)
                    .execute(
                        s ->
                            eventService.update(
                                ownerId,
                                created.id(),
                                edit,
                                com.workplace.calendar.dto.EditScope.ALL,
                                null)))
        .isInstanceOf(ExternalCalendarWriteInTransactionException.class);

    verify(calendarTransport, never()).updateEvent(anyLong(), any(), any(), any());
    // 로컬 제목 불변.
    assertThat(eventService.get(ownerId, created.id()).title()).isEqualTo("회의");
  }

  /** 순수 로컬 일정 수정 → transport 미호출(역동기화 없음). */
  @Test
  void update_local_event_does_not_call_transport() {
    long localCal = calendarRepo.insert(ownerId, "개인", "green", true, 1);
    CalendarEventResponse created = eventService.create(ownerId, req(localCal, null));
    CalendarEventRequest edit =
        new CalendarEventRequest(
            "로컬수정",
            null,
            OffsetDateTime.parse("2026-07-10T09:00:00Z"),
            OffsetDateTime.parse("2026-07-10T10:00:00Z"),
            false,
            null,
            null,
            null,
            null,
            null,
            localCal);
    eventService.update(
        ownerId, created.id(), edit, com.workplace.calendar.dto.EditScope.ALL, null);
    verify(calendarTransport, never()).updateEvent(anyLong(), any(), any(), any());
  }

  // ── 로컬 → 외부 쓰기 캘린더 이동 적격성(WP-2155) ───────────────────────────

  /** 외부 이동 요청 — 제목·시각만 채우고 대상 캘린더만 지정한다. */
  private CalendarEventRequest moveReq(Long targetCalId) {
    return new CalendarEventRequest(
        "이동",
        null,
        OffsetDateTime.parse("2026-07-10T09:00:00Z"),
        OffsetDateTime.parse("2026-07-10T10:00:00Z"),
        false,
        null,
        null,
        null,
        null,
        null,
        targetCalId);
  }

  /** 참석자가 있는 로컬 일정은 Outlook 캘린더로 옮길 수 없다 — 422, Graph 미호출, 소속 캘린더 불변(WP-2155). */
  @Test
  void update_local_event_with_attendee_move_to_external_is_rejected_422() {
    long inviteeId =
        new TransactionTemplate(txManager)
            .execute(s -> withMembership(TestFixtures.createHuman(dsl)));
    long localCal = calendarRepo.insert(ownerId, "개인", "green", true, 1);
    CalendarEventRequest withAttendee =
        new CalendarEventRequest(
            "참석자 회의",
            null,
            OffsetDateTime.parse("2026-07-10T09:00:00Z"),
            OffsetDateTime.parse("2026-07-10T10:00:00Z"),
            false,
            null,
            null,
            null,
            null,
            List.of(inviteeId),
            localCal);
    CalendarEventResponse created = eventService.create(ownerId, withAttendee);

    assertThatThrownBy(
            () ->
                eventService.update(
                    ownerId,
                    created.id(),
                    moveReq(extCalId),
                    com.workplace.calendar.dto.EditScope.ALL,
                    null))
        .isInstanceOf(
            com.workplace.calendar.exception.LocalToExternalMoveNotSupportedException.class)
        .hasMessageContaining("참석자");
    verify(calendarTransport, never()).createEvent(anyLong(), any(), any(), any());
    assertThat(eventService.get(ownerId, created.id()).calendarId()).isEqualTo(localCal);
  }

  /** 반복 로컬 일정은 Outlook 캘린더로 옮길 수 없다 — 422, Graph 미호출(WP-2155). */
  @Test
  void update_local_recurring_event_move_to_external_is_rejected_422() {
    long localCal = calendarRepo.insert(ownerId, "개인", "green", true, 1);
    CalendarEventResponse created =
        eventService.create(ownerId, req(localCal, "FREQ=DAILY;COUNT=3"));

    assertThatThrownBy(
            () ->
                eventService.update(
                    ownerId,
                    created.id(),
                    req(extCalId, "FREQ=DAILY;COUNT=3"),
                    com.workplace.calendar.dto.EditScope.ALL,
                    null))
        .isInstanceOf(
            com.workplace.calendar.exception.LocalToExternalMoveNotSupportedException.class)
        .hasMessageContaining("반복");
    verify(calendarTransport, never()).createEvent(anyLong(), any(), any(), any());
  }

  /**
   * 수정 요청은 전체 교체라 recurrenceRule=null 은 「반복 해제」다 — 반복을 풀며 「전체 일정」으로 옮기면 결과가 단일 일정이므로 Outlook 에 만들고
   * 연결한다(WP-2155).
   */
  @Test
  void update_recurring_event_cleared_and_moved_whole_series_converts() {
    when(calendarTransport.createEvent(eq(ownerId), any(), eq("gcal-write"), any()))
        .thenReturn("graph-cleared");
    long localCal = calendarRepo.insert(ownerId, "개인", "green", true, 1);
    CalendarEventResponse created =
        eventService.create(ownerId, req(localCal, "FREQ=DAILY;COUNT=3"));

    eventService.update(
        ownerId, created.id(), moveReq(extCalId), com.workplace.calendar.dto.EditScope.ALL, null);

    verify(calendarTransport).createEvent(eq(ownerId), any(), eq("gcal-write"), any());
    CalendarEventResponse after = eventService.get(ownerId, created.id());
    assertThat(after.calendarId()).isEqualTo(extCalId);
    assertThat(after.recurrenceRule()).isNull();
    assertThat(externalIdOf(created.id())).isEqualTo("graph-cleared");
  }

  /**
   * 예외 행(취소한 회차)이 남은 반복 마스터는 규칙을 지우며 「전체 일정」으로 옮겨도 반복으로 본다 — 로컬 ALL 수정은 예외를 지우지 않아 마스터만 Outlook 에
   * 만들면 그 회차가 로컬에 갈라져 남기 때문이다. 422, Graph 미호출, 캘린더 그대로(WP-2155).
   */
  @Test
  void update_recurring_with_exception_cleared_and_moved_is_rejected_422() {
    long localCal = calendarRepo.insert(ownerId, "개인", "green", true, 1);
    CalendarEventResponse created =
        eventService.create(ownerId, req(localCal, "FREQ=DAILY;COUNT=3"));
    new TransactionTemplate(txManager)
        .executeWithoutResult(
            s -> exceptionRepo.insertCancellation(created.id(), created.startsAt().plusDays(1)));

    assertThatThrownBy(
            () ->
                eventService.update(
                    ownerId,
                    created.id(),
                    moveReq(extCalId),
                    com.workplace.calendar.dto.EditScope.ALL,
                    null))
        .isInstanceOf(
            com.workplace.calendar.exception.LocalToExternalMoveNotSupportedException.class)
        .hasMessageContaining("반복");
    verify(calendarTransport, never()).createEvent(anyLong(), any(), any(), any());
    assertThat(eventService.get(ownerId, created.id()).calendarId()).isEqualTo(localCal);
  }

  /** 로컬 일정을 외부 쓰기 캘린더로 직접 옮겨 둔 고아 상태를 만든다 — 서비스 경로는 Graph 생성을 타므로 DB 로 심는다(WP-2155). */
  private void forceIntoExternalCalendar(long eventId) {
    new TransactionTemplate(txManager)
        .executeWithoutResult(
            s ->
                dsl.update(CALENDAR_EVENT)
                    .set(CALENDAR_EVENT.CALENDAR_ID, extCalId)
                    .where(CALENDAR_EVENT.ID.eq(eventId))
                    .execute());
  }

  /** 참석자 있는 고아 일정(이동 아님) 편집은 막히지 않는다 — 200, Graph 생성 미호출, 필드 갱신(WP-2155). */
  @Test
  void update_orphan_with_attendee_without_move_succeeds_without_graph_create() {
    long inviteeId =
        new TransactionTemplate(txManager)
            .execute(s -> withMembership(TestFixtures.createHuman(dsl)));
    long localCal = calendarRepo.insert(ownerId, "개인", "green", true, 1);
    CalendarEventResponse created =
        eventService.create(
            ownerId,
            new CalendarEventRequest(
                "고아 참석자",
                null,
                OffsetDateTime.parse("2026-07-10T09:00:00Z"),
                OffsetDateTime.parse("2026-07-10T10:00:00Z"),
                false,
                null,
                null,
                null,
                null,
                List.of(inviteeId),
                localCal));
    forceIntoExternalCalendar(created.id());

    eventService.update(
        ownerId, created.id(), moveReq(null), com.workplace.calendar.dto.EditScope.ALL, null);

    verify(calendarTransport, never()).createEvent(anyLong(), any(), any(), any());
    assertThat(eventService.get(ownerId, created.id()).title()).isEqualTo("이동");
  }

  /** 반복을 유지한 반복 고아 일정(이동 아님) 편집은 422 없이 로컬 수정으로 통과한다 — 요청이 규칙을 그대로 실어 보낸다(WP-2155). */
  @Test
  void update_orphan_recurring_without_move_succeeds_without_422() {
    long localCal = calendarRepo.insert(ownerId, "개인", "green", true, 1);
    CalendarEventResponse created =
        eventService.create(ownerId, req(localCal, "FREQ=DAILY;COUNT=3"));
    forceIntoExternalCalendar(created.id());

    eventService.update(
        ownerId,
        created.id(),
        req(null, "FREQ=DAILY;COUNT=3"),
        com.workplace.calendar.dto.EditScope.ALL,
        null);

    verify(calendarTransport, never()).createEvent(anyLong(), any(), any(), any());
    assertThat(eventService.get(ownerId, created.id()).recurrenceRule())
        .isEqualTo("FREQ=DAILY;COUNT=3");
  }

  /** 읽기전용 외부 캘린더로의 이동은 기존대로 409 — 전환 대상이 아니다(WP-2155). */
  @Test
  void update_local_event_move_to_readonly_external_is_rejected_409() {
    long roCal =
        new TransactionTemplate(txManager)
            .execute(
                s ->
                    dsl.insertInto(CALENDAR)
                        .set(CALENDAR.OWNER_ID, ownerId)
                        .set(CALENDAR.NAME, "읽기전용")
                        .set(CALENDAR.COLOR, "gray")
                        .set(CALENDAR.IS_DEFAULT, false)
                        .set(CALENDAR.POSITION, 3)
                        .set(CALENDAR.EXTERNAL_ACCOUNT_ID, accountId)
                        .set(CALENDAR.EXTERNAL_ID, "gcal-ro")
                        .set(CALENDAR.IS_READ_ONLY, true)
                        .set(CALENDAR.TENANT_ID, TENANT_ID)
                        .returning(CALENDAR.ID)
                        .fetchOne()
                        .getId());
    long localCal = calendarRepo.insert(ownerId, "개인", "green", true, 1);
    CalendarEventResponse created = eventService.create(ownerId, req(localCal, null));

    assertThatThrownBy(
            () ->
                eventService.update(
                    ownerId,
                    created.id(),
                    moveReq(roCal),
                    com.workplace.calendar.dto.EditScope.ALL,
                    null))
        .isInstanceOf(com.workplace.calendar.exception.ReadOnlyCalendarException.class);
    verify(calendarTransport, never()).createEvent(anyLong(), any(), any(), any());
  }

  /** 행의 external_id — 전환 뒤 Graph 연결 확인용(WP-2155). */
  private String externalIdOf(long eventId) {
    return new TransactionTemplate(txManager)
        .execute(
            s ->
                dsl.select(CALENDAR_EVENT.EXTERNAL_ID)
                    .from(CALENDAR_EVENT)
                    .where(CALENDAR_EVENT.ID.eq(eventId))
                    .fetchOne(CALENDAR_EVENT.EXTERNAL_ID));
  }

  /** 단일 로컬 일정을 Outlook 쓰기 캘린더로 옮기며 수정하면 Graph 에 만들고 external_id 를 연결한다(WP-2155). */
  @Test
  void update_local_event_move_to_external_creates_in_graph_and_links_externalId() {
    when(calendarTransport.createEvent(eq(ownerId), any(), eq("gcal-write"), any()))
        .thenReturn("graph-new-1");
    long localCal = calendarRepo.insert(ownerId, "개인", "green", true, 1);
    CalendarEventResponse created = eventService.create(ownerId, req(localCal, null));

    eventService.update(
        ownerId, created.id(), moveReq(extCalId), com.workplace.calendar.dto.EditScope.ALL, null);

    verify(calendarTransport)
        .createEvent(eq(ownerId), any(), eq("gcal-write"), argThat(w -> "이동".equals(w.subject())));
    assertThat(externalIdOf(created.id())).isEqualTo("graph-new-1");
    CalendarEventResponse after = eventService.get(ownerId, created.id());
    assertThat(after.calendarId()).isEqualTo(extCalId);
    assertThat(after.external()).isTrue();
  }

  /** 이미 Outlook 쓰기 캘린더에 있으나 external_id 가 없는 고아 일정은 수정할 때 Graph 에 만들어 연결한다(자가 치유, WP-2155). */
  @Test
  void update_orphan_event_in_external_calendar_creates_in_graph() {
    when(calendarTransport.createEvent(eq(ownerId), any(), eq("gcal-write"), any()))
        .thenReturn("graph-orphan-1");
    long localCal = calendarRepo.insert(ownerId, "개인", "green", true, 1);
    CalendarEventResponse created = eventService.create(ownerId, req(localCal, null));
    forceIntoExternalCalendar(created.id());

    eventService.update(
        ownerId, created.id(), moveReq(null), com.workplace.calendar.dto.EditScope.ALL, null);

    verify(calendarTransport, org.mockito.Mockito.times(1))
        .createEvent(eq(ownerId), any(), eq("gcal-write"), any());
    assertThat(externalIdOf(created.id())).isEqualTo("graph-orphan-1");
  }

  /** Graph 생성이 실패하면 예외를 그대로 전파하고 로컬 행(캘린더·제목·external_id)은 바뀌지 않는다(WP-2155). */
  @Test
  void update_local_move_to_external_graph_failure_keeps_local_unchanged() {
    when(calendarTransport.createEvent(eq(ownerId), any(), eq("gcal-write"), any()))
        .thenThrow(new ExternalCalendarWriteException("Graph 실패", new RuntimeException("503")));
    long localCal = calendarRepo.insert(ownerId, "개인", "green", true, 1);
    CalendarEventResponse created = eventService.create(ownerId, req(localCal, null));

    assertThatThrownBy(
            () ->
                eventService.update(
                    ownerId,
                    created.id(),
                    moveReq(extCalId),
                    com.workplace.calendar.dto.EditScope.ALL,
                    null))
        .isInstanceOf(ExternalCalendarWriteException.class);

    CalendarEventResponse after = eventService.get(ownerId, created.id());
    assertThat(after.calendarId()).isEqualTo(localCal);
    assertThat(after.title()).isEqualTo("회의");
    assertThat(externalIdOf(created.id())).isNull();
  }

  /** 낡은 expectedUpdatedAt 은 Graph 를 부르기 전에 409 — 화면이 본 뒤 바뀐 일정이 Outlook 에 만들어지지 않는다(WP-2155). */
  @Test
  void update_local_move_to_external_stale_version_conflicts_before_graph() {
    long localCal = calendarRepo.insert(ownerId, "개인", "green", true, 1);
    CalendarEventResponse created = eventService.create(ownerId, req(localCal, null));

    assertThatThrownBy(
            () ->
                eventService.update(
                    ownerId,
                    created.id(),
                    moveReq(extCalId),
                    com.workplace.calendar.dto.EditScope.ALL,
                    null,
                    created.updatedAt().minusSeconds(60)))
        .isInstanceOf(com.workplace.calendar.exception.CalendarEventConflictException.class);
    verify(calendarTransport, never()).createEvent(anyLong(), any(), any(), any());
  }

  /** 외부 캘린더의 연동 계정이 호출자의 것이 아니면(끊김·삭제와 같은 조회 실패) 전환 대상이 아니다 — Graph 없이 캘린더만 옮긴다(WP-2155). */
  @Test
  void update_local_move_to_external_whose_account_was_deleted_moves_locally() {
    long localCal = calendarRepo.insert(ownerId, "개인", "green", true, 1);
    CalendarEventResponse created = eventService.create(ownerId, req(localCal, null));
    // 계정 행을 지우면 캘린더가 같이 지워지므로, 호출자 계정으로 조회되지 않는 다른 사용자의 계정으로 바꿔 끊김을 흉내 낸다.
    final long stranger =
        new TransactionTemplate(txManager).execute(s -> TestFixtures.createHuman(dsl));
    final long foreignAcc =
        new TransactionTemplate(txManager)
            .execute(
                s ->
                    dsl.insertInto(EMAIL_ACCOUNT)
                        .set(EMAIL_ACCOUNT.USER_ID, stranger)
                        .set(EMAIL_ACCOUNT.EMAIL_ADDRESS, stranger + "@iacloud.kr")
                        .set(EMAIL_ACCOUNT.PROVIDER, "M365_GRAPH")
                        .set(EMAIL_ACCOUNT.OAUTH_REFRESH_TOKEN, encryption.encrypt("RT"))
                        .set(EMAIL_ACCOUNT.AI_ENABLED, false)
                        .set(EMAIL_ACCOUNT.TENANT_ID, TENANT_ID)
                        .returning(EMAIL_ACCOUNT.ID)
                        .fetchOne()
                        .getId());
    try {
      new TransactionTemplate(txManager)
          .executeWithoutResult(
              s ->
                  dsl.update(CALENDAR)
                      .set(CALENDAR.EXTERNAL_ACCOUNT_ID, foreignAcc)
                      .where(CALENDAR.ID.eq(extCalId))
                      .execute());

      eventService.update(
          ownerId, created.id(), moveReq(extCalId), com.workplace.calendar.dto.EditScope.ALL, null);

      verify(calendarTransport, never()).createEvent(anyLong(), any(), any(), any());
      assertThat(eventService.get(ownerId, created.id()).calendarId()).isEqualTo(extCalId);
    } finally {
      cleanupInTenant(
          TENANT_ID,
          () -> {
            dsl.deleteFrom(CALENDAR_EVENT).where(CALENDAR_EVENT.OWNER_ID.eq(ownerId)).execute();
            dsl.deleteFrom(CALENDAR).where(CALENDAR.OWNER_ID.eq(ownerId)).execute();
            dsl.deleteFrom(EMAIL_ACCOUNT).where(EMAIL_ACCOUNT.ID.eq(foreignAcc)).execute();
            dsl.execute("DELETE FROM \"user\" WHERE id = ?", stranger);
          });
    }
  }

  /** 범주를 못 쓰는 공유 M365 캘린더로 태그와 함께 옮기면 409 — Graph 호출·로컬 변경 없음(WP-2155). */
  @Test
  void update_local_move_to_shared_external_with_tags_is_rejected_409() {
    long tagId = tagService.create(ownerId, new CalendarTagRequest("운영", null)).id();
    long localCal = calendarRepo.insert(ownerId, "개인", "green", true, 1);
    CalendarEventResponse created = eventService.create(ownerId, req(localCal, null));

    assertThatThrownBy(
            () ->
                eventService.update(
                    ownerId,
                    created.id(),
                    withTags(moveReq(extCalId), List.of(tagId)),
                    com.workplace.calendar.dto.EditScope.ALL,
                    null))
        .isInstanceOf(ExternalEventTagNotSupportedException.class);
    verify(calendarTransport, never()).createEvent(anyLong(), any(), any(), any());
    assertThat(eventService.get(ownerId, created.id()).calendarId()).isEqualTo(localCal);
  }

  // ── 전환의 태그·연결 실패·반복 회차·바깥 tx(WP-2155 최종 리뷰) ───────────────────

  /** 일정의 태그 연결 출처 목록 — APP 연결이 남았는지 확인용(WP-2155). */
  private List<String> tagSourcesOf(long eventId) {
    return new TransactionTemplate(txManager)
        .execute(
            s ->
                dsl.select(CALENDAR_EVENT_TAG.SOURCE)
                    .from(CALENDAR_EVENT_TAG)
                    .where(CALENDAR_EVENT_TAG.EVENT_ID.eq(eventId))
                    .fetch(CALENDAR_EVENT_TAG.SOURCE));
  }

  /** 내 사서함 캘린더로 태그를 실어 옮기면 연결 뒤 Outlook 범주로 써 넣는다 — 내 사서함 여부를 tx 안에서 읽어야 한다(RLS, WP-2155). */
  @Test
  void update_move_to_own_mailbox_with_tags_writes_outlook_categories() {
    markOwnMailbox();
    long tagId = tagService.create(ownerId, new CalendarTagRequest("고객사", null)).id();
    when(calendarTransport.createEvent(eq(ownerId), any(), eq("gcal-write"), any()))
        .thenReturn("graph-conv-t1");
    liveCategories("graph-conv-t1", List.of());
    long localCal = calendarRepo.insert(ownerId, "개인", "green", true, 1);
    CalendarEventResponse created = eventService.create(ownerId, req(localCal, null));

    CalendarEventResponse after =
        eventService.update(
            ownerId,
            created.id(),
            withTags(moveReq(extCalId), List.of(tagId)),
            com.workplace.calendar.dto.EditScope.ALL,
            null);

    verify(calendarTransport)
        .updateCategories(eq(ownerId), any(), eq("graph-conv-t1"), eq(List.of("고객사")));
    assertThat(tagNames(after)).containsExactly("고객사");
    assertThat(tagSourcesOf(created.id())).containsExactly("OUTLOOK");
  }

  /** 태그를 보내지 않은 이동은 지금 붙은 앱 태그를 Outlook 범주로 옮긴다 — APP 연결은 남지 않는다(다시 뗄 수 있게, WP-2155). */
  @Test
  void update_plain_move_to_own_mailbox_moves_app_tags_to_outlook() {
    markOwnMailbox();
    long tagId = tagService.create(ownerId, new CalendarTagRequest("운영", null)).id();
    when(calendarTransport.createEvent(eq(ownerId), any(), eq("gcal-write"), any()))
        .thenReturn("graph-conv-t2");
    liveCategories("graph-conv-t2", List.of());
    long localCal = calendarRepo.insert(ownerId, "개인", "green", true, 1);
    CalendarEventResponse created =
        eventService.create(ownerId, withTags(req(localCal, null), List.of(tagId)));
    assertThat(tagSourcesOf(created.id())).containsExactly("APP");

    eventService.update(
        ownerId, created.id(), moveReq(extCalId), com.workplace.calendar.dto.EditScope.ALL, null);

    verify(calendarTransport)
        .updateCategories(eq(ownerId), any(), eq("graph-conv-t2"), eq(List.of("운영")));
    assertThat(tagSourcesOf(created.id())).containsExactly("OUTLOOK");
  }

  /** 앱 태그가 붙은 일정을 범주를 못 쓰는 공유 캘린더로 그냥 옮겨도 409 — 태그가 조용히 갇히지 않게 Graph 전에 막는다(WP-2155). */
  @Test
  void update_plain_move_of_app_tagged_event_to_shared_external_is_rejected_409() {
    long tagId = tagService.create(ownerId, new CalendarTagRequest("운영", null)).id();
    long localCal = calendarRepo.insert(ownerId, "개인", "green", true, 1);
    CalendarEventResponse created =
        eventService.create(ownerId, withTags(req(localCal, null), List.of(tagId)));

    assertThatThrownBy(
            () ->
                eventService.update(
                    ownerId,
                    created.id(),
                    moveReq(extCalId),
                    com.workplace.calendar.dto.EditScope.ALL,
                    null))
        .isInstanceOf(ExternalEventTagNotSupportedException.class);
    verify(calendarTransport, never()).createEvent(anyLong(), any(), any(), any());
    assertThat(eventService.get(ownerId, created.id()).calendarId()).isEqualTo(localCal);
  }

  /**
   * 연결 tx 가 실패하면(동기화가 같은 id 를 먼저 들임 — uq_event_external) 방금 만든 Outlook 일정을 지우고 원래 오류를 던진다(WP-2155).
   */
  @Test
  void update_move_link_failure_deletes_created_graph_event_and_keeps_local() {
    long localCal = calendarRepo.insert(ownerId, "개인", "green", true, 1);
    CalendarEventResponse synced = eventService.create(ownerId, req(localCal, null));
    new TransactionTemplate(txManager)
        .executeWithoutResult(
            s ->
                dsl.update(CALENDAR_EVENT)
                    .set(CALENDAR_EVENT.CALENDAR_ID, extCalId)
                    .set(CALENDAR_EVENT.EXTERNAL_ID, "graph-dup")
                    .where(CALENDAR_EVENT.ID.eq(synced.id()))
                    .execute());
    when(calendarTransport.createEvent(eq(ownerId), any(), eq("gcal-write"), any()))
        .thenReturn("graph-dup");
    CalendarEventResponse created = eventService.create(ownerId, req(localCal, null));

    assertThatThrownBy(
            () ->
                eventService.update(
                    ownerId,
                    created.id(),
                    moveReq(extCalId),
                    com.workplace.calendar.dto.EditScope.ALL,
                    null))
        .isInstanceOf(org.springframework.dao.DataIntegrityViolationException.class);

    verify(calendarTransport).deleteEvent(eq(ownerId), any(), eq("graph-dup"));
    CalendarEventResponse after = eventService.get(ownerId, created.id());
    assertThat(after.calendarId()).isEqualTo(localCal);
    assertThat(after.title()).isEqualTo("회의");
    assertThat(externalIdOf(created.id())).isNull();
  }

  /**
   * Graph 생성 사이에 같은 일정이 이미 연결되면(동시 저장·버전 없는 재요청) 잠금 뒤 다시 보고 409 — 앞선 연결을 덮어쓰지 않고 방금 만든 Outlook 일정은
   * 지운다(WP-2155).
   */
  @Test
  void update_move_already_linked_under_lock_conflicts_and_deletes_created_graph_event() {
    long localCal = calendarRepo.insert(ownerId, "개인", "green", true, 1);
    CalendarEventResponse created = eventService.create(ownerId, req(localCal, null));
    // Graph 호출 중에 다른 요청이 먼저 연결을 끝낸 상황을 흉내 낸다.
    when(calendarTransport.createEvent(eq(ownerId), any(), eq("gcal-write"), any()))
        .thenAnswer(
            inv -> {
              new TransactionTemplate(txManager)
                  .executeWithoutResult(
                      s ->
                          dsl.update(CALENDAR_EVENT)
                              .set(CALENDAR_EVENT.EXTERNAL_ID, "graph-first")
                              .where(CALENDAR_EVENT.ID.eq(created.id()))
                              .execute());
              return "graph-second";
            });

    assertThatThrownBy(
            () ->
                eventService.update(
                    ownerId,
                    created.id(),
                    moveReq(extCalId),
                    com.workplace.calendar.dto.EditScope.ALL,
                    null))
        .isInstanceOf(com.workplace.calendar.exception.CalendarEventConflictException.class);

    verify(calendarTransport).deleteEvent(eq(ownerId), any(), eq("graph-second"));
    assertThat(externalIdOf(created.id())).isEqualTo("graph-first");
    CalendarEventResponse after = eventService.get(ownerId, created.id());
    assertThat(after.calendarId()).isEqualTo(localCal);
    assertThat(after.title()).isEqualTo("회의");
  }

  /**
   * 이미 Outlook id 가 있지만 계정이 끊겨 로컬처럼 보이는 일정은 전환하지 않는다 — Graph 생성 없이 예전처럼 로컬 이동, external_id
   * 유지(WP-2155).
   */
  @Test
  void update_event_with_external_id_but_disconnected_moves_locally_without_graph_create() {
    long localCal = calendarRepo.insert(ownerId, "개인", "green", true, 1);
    CalendarEventResponse created = eventService.create(ownerId, req(localCal, null));
    new TransactionTemplate(txManager)
        .executeWithoutResult(
            s ->
                dsl.update(CALENDAR_EVENT)
                    .set(CALENDAR_EVENT.EXTERNAL_ID, "graph-stale")
                    .where(CALENDAR_EVENT.ID.eq(created.id()))
                    .execute());

    eventService.update(
        ownerId, created.id(), moveReq(extCalId), com.workplace.calendar.dto.EditScope.ALL, null);

    verify(calendarTransport, never()).createEvent(anyLong(), any(), any(), any());
    verify(calendarTransport, never()).deleteEvent(anyLong(), any(), any());
    assertThat(eventService.get(ownerId, created.id()).calendarId()).isEqualTo(extCalId);
    assertThat(externalIdOf(created.id())).isEqualTo("graph-stale");
  }

  /** 「이 일정만」 고친 회차(override, RRULE 없음)도 반복으로 보아 Outlook 캘린더 이동은 422 — Graph 미호출(WP-2155). */
  @Test
  void update_override_occurrence_move_to_external_is_rejected_422() {
    long localCal = calendarRepo.insert(ownerId, "개인", "green", true, 1);
    CalendarEventResponse series =
        eventService.create(ownerId, req(localCal, "FREQ=DAILY;COUNT=3"));
    OffsetDateTime occ = OffsetDateTime.parse("2026-07-11T09:00:00Z");
    CalendarEventResponse override =
        eventService.update(
            ownerId,
            series.id(),
            new CalendarEventRequest(
                "고친 회차", null, occ, occ.plusHours(1), false, null, null, null, null, null, null),
            com.workplace.calendar.dto.EditScope.THIS,
            occ);
    assertThat(override.id()).isNotEqualTo(series.id());

    assertThatThrownBy(
            () ->
                eventService.update(
                    ownerId,
                    override.id(),
                    moveReq(extCalId),
                    com.workplace.calendar.dto.EditScope.ALL,
                    null))
        .isInstanceOf(
            com.workplace.calendar.exception.LocalToExternalMoveNotSupportedException.class)
        .hasMessageContaining("반복");
    verify(calendarTransport, never()).createEvent(anyLong(), any(), any(), any());
  }

  /** 앱 태그가 붙은 고아 일정이 공유 캘린더에 있으면 전환하지 않고 로컬 수정으로 통과한다 — 저장마다 409 가 나지 않는다(WP-2155). */
  @Test
  void update_orphan_with_app_tag_in_shared_external_edits_locally() {
    long tagId = tagService.create(ownerId, new CalendarTagRequest("운영", null)).id();
    long localCal = calendarRepo.insert(ownerId, "개인", "green", true, 1);
    CalendarEventResponse created =
        eventService.create(ownerId, withTags(req(localCal, null), List.of(tagId)));
    forceIntoExternalCalendar(created.id());

    eventService.update(
        ownerId, created.id(), moveReq(null), com.workplace.calendar.dto.EditScope.ALL, null);

    verify(calendarTransport, never()).createEvent(anyLong(), any(), any(), any());
    assertThat(eventService.get(ownerId, created.id()).title()).isEqualTo("이동");
    assertThat(tagSourcesOf(created.id())).containsExactly("APP");
  }

  /** 바깥 tx(AI·채팅 confirm) 안의 고아 일정 편집은 전환하지 않고 예전처럼 로컬 수정으로 통과한다 — 409 가 나지 않는다(WP-2155). */
  @Test
  void update_orphan_without_move_within_ambient_tx_edits_locally() {
    long localCal = calendarRepo.insert(ownerId, "개인", "green", true, 1);
    CalendarEventResponse created = eventService.create(ownerId, req(localCal, null));
    forceIntoExternalCalendar(created.id());

    new TransactionTemplate(txManager)
        .execute(
            s ->
                eventService.update(
                    ownerId,
                    created.id(),
                    moveReq(null),
                    com.workplace.calendar.dto.EditScope.ALL,
                    null));

    verify(calendarTransport, never()).createEvent(anyLong(), any(), any(), any());
    assertThat(eventService.get(ownerId, created.id()).title()).isEqualTo("이동");
    assertThat(externalIdOf(created.id())).isNull();
  }

  /**
   * 바깥 tx(AI·채팅 confirm) 안의 로컬→Outlook 이동은 분명한 오류로 거절한다 — 로컬로만 옮기면 「Outlook 에 없는」 일정이 다시 생긴다. Graph
   * 미호출, 소속 캘린더 불변(WP-2155).
   */
  @Test
  void update_move_to_external_within_ambient_tx_is_rejected() {
    long localCal = calendarRepo.insert(ownerId, "개인", "green", true, 1);
    CalendarEventResponse created = eventService.create(ownerId, req(localCal, null));

    assertThatThrownBy(
            () ->
                new TransactionTemplate(txManager)
                    .execute(
                        s ->
                            eventService.update(
                                ownerId,
                                created.id(),
                                moveReq(extCalId),
                                com.workplace.calendar.dto.EditScope.ALL,
                                null)))
        .isInstanceOf(
            com.workplace.calendar.exception.ExternalCalendarWriteInTransactionException.class);

    verify(calendarTransport, never()).createEvent(anyLong(), any(), any(), any());
    assertThat(eventService.get(ownerId, created.id()).calendarId()).isEqualTo(localCal);
  }

  /**
   * 전환 뒤 Outlook 범주 쓰기가 일시 오류로 실패해도 저장은 성공으로 돌려주고 태그 없이 둔다 — 일정은 이미 Outlook 에 연결됐고, 다시 저장하면 중복 생성되기
   * 때문이다. 앱 태그(APP)는 남기지 않는다(남기면 다시는 뗄 수 없다)(WP-2155).
   */
  @Test
  void update_move_to_own_mailbox_categories_transient_failure_keeps_conversion_without_tags() {
    markOwnMailbox();
    long tagId = tagService.create(ownerId, new CalendarTagRequest("운영", null)).id();
    when(calendarTransport.createEvent(eq(ownerId), any(), eq("gcal-write"), any()))
        .thenReturn("graph-conv-fail");
    liveCategories("graph-conv-fail", List.of());
    org.mockito.Mockito.doThrow(
            new ExternalCalendarWriteException("Graph 범주 쓰기 실패", new RuntimeException("503")))
        .when(calendarTransport)
        .updateCategories(eq(ownerId), any(), eq("graph-conv-fail"), anyList());
    long localCal = calendarRepo.insert(ownerId, "개인", "green", true, 1);
    CalendarEventResponse created =
        eventService.create(ownerId, withTags(req(localCal, null), List.of(tagId)));

    CalendarEventResponse result =
        eventService.update(
            ownerId,
            created.id(),
            moveReq(extCalId),
            com.workplace.calendar.dto.EditScope.ALL,
            null);

    assertThat(result.calendarId()).isEqualTo(extCalId);
    assertThat(externalIdOf(created.id())).isEqualTo("graph-conv-fail");
    assertThat(tagSourcesOf(created.id())).isEmpty();
  }

  // ── delete write-through (Task 9) ──────────────────────────────────────────

  /** 외부 동기화 일정 삭제 → Graph DELETE(deleteEvent) 호출 + 로컬 행 제거. */
  @Test
  void delete_external_event_calls_graph_delete_and_removes_local() {
    when(calendarTransport.createEvent(eq(ownerId), any(), eq("gcal-write"), any()))
        .thenReturn("graph-evt-7");
    CalendarEventResponse created = eventService.create(ownerId, req(extCalId, null));

    eventService.delete(ownerId, created.id(), com.workplace.calendar.dto.EditScope.ALL, null);

    verify(calendarTransport).deleteEvent(eq(ownerId), any(), eq("graph-evt-7"));
    Integer cnt =
        new TransactionTemplate(txManager)
            .execute(
                s ->
                    dsl.fetchCount(
                        dsl.selectFrom(CALENDAR_EVENT).where(CALENDAR_EVENT.ID.eq(created.id()))));
    assertThat(cnt).isZero();
  }

  /**
   * Graph DELETE 404(이미 없음) → 성공. transport.deleteEvent 가 정상 반환(GraphApiClient 가 404 를 성공 처리)하면 예외
   * 없이 로컬 삭제까지 진행한다. 502(아래 테스트)와의 분기: 404 는 transport 가 throw 하지 않으므로 502 로 둔갑하지 않고 로컬 삭제를 막지 않는다.
   */
  @Test
  void delete_external_event_graph_404_still_removes_local() {
    when(calendarTransport.createEvent(eq(ownerId), any(), eq("gcal-write"), any()))
        .thenReturn("graph-evt-8");
    CalendarEventResponse created = eventService.create(ownerId, req(extCalId, null));
    // 404 = 이미 없음 → transport 가 예외 없이 정상 반환하는 것으로 모사(GraphApiClient.delete 가 404 를 성공 취급).
    org.mockito.Mockito.doNothing()
        .when(calendarTransport)
        .deleteEvent(eq(ownerId), any(), eq("graph-evt-8"));

    // 예외 없이 완료되어야 한다(404 가 502 로 둔갑하지 않음).
    eventService.delete(ownerId, created.id(), com.workplace.calendar.dto.EditScope.ALL, null);

    verify(calendarTransport).deleteEvent(eq(ownerId), any(), eq("graph-evt-8"));
    Integer cnt =
        new TransactionTemplate(txManager)
            .execute(
                s ->
                    dsl.fetchCount(
                        dsl.selectFrom(CALENDAR_EVENT).where(CALENDAR_EVENT.ID.eq(created.id()))));
    assertThat(cnt).isZero();
  }

  /** Graph DELETE 실패(502, non-404) → 예외 전파 + 로컬 행 미삭제(HTTP 가 persist 트랜잭션 진입 전에 실패). */
  @Test
  void delete_external_event_graph_failure_502_keeps_local_row() {
    when(calendarTransport.createEvent(eq(ownerId), any(), eq("gcal-write"), any()))
        .thenReturn("graph-evt-9");
    CalendarEventResponse created = eventService.create(ownerId, req(extCalId, null));
    org.mockito.Mockito.doThrow(
            new ExternalCalendarWriteException("graph 삭제 실패", new RuntimeException("boom")))
        .when(calendarTransport)
        .deleteEvent(eq(ownerId), any(), eq("graph-evt-9"));

    assertThatThrownBy(
            () ->
                eventService.delete(
                    ownerId, created.id(), com.workplace.calendar.dto.EditScope.ALL, null))
        .isInstanceOf(ExternalCalendarWriteException.class);
    // 로컬 행이 남아 있어야 한다(삭제되지 않음).
    assertThat(eventService.get(ownerId, created.id()).id()).isEqualTo(created.id());
  }

  /**
   * 가드(#502, 후속 #548): 호출자의 ambient 트랜잭션(AI·채팅 confirm 경로) 안에서 외부 일정 삭제 진입 시 →
   * ExternalCalendarWriteInTransactionException(409). Graph DELETE 미호출 + 로컬 행 잔존을 함께 검증한다.
   */
  @Test
  void delete_external_event_within_ambient_tx_rejected_and_no_graph_no_local_delete() {
    when(calendarTransport.createEvent(eq(ownerId), any(), eq("gcal-write"), any()))
        .thenReturn("graph-evt-10");
    CalendarEventResponse created = eventService.create(ownerId, req(extCalId, null));

    assertThatThrownBy(
            () ->
                new TransactionTemplate(txManager)
                    .execute(
                        s -> {
                          eventService.delete(
                              ownerId,
                              created.id(),
                              com.workplace.calendar.dto.EditScope.ALL,
                              null);
                          return null;
                        }))
        .isInstanceOf(ExternalCalendarWriteInTransactionException.class);

    verify(calendarTransport, never()).deleteEvent(anyLong(), any(), any());
    // 로컬 행 잔존(삭제되지 않음).
    assertThat(eventService.get(ownerId, created.id()).id()).isEqualTo(created.id());
  }

  /** 순수 로컬 일정 삭제 → transport 미호출(역동기화 없음). */
  @Test
  void delete_local_event_does_not_call_transport() {
    long localCal = calendarRepo.insert(ownerId, "개인", "green", true, 1);
    CalendarEventResponse created = eventService.create(ownerId, req(localCal, null));
    eventService.delete(ownerId, created.id(), com.workplace.calendar.dto.EditScope.ALL, null);
    verify(calendarTransport, never()).deleteEvent(anyLong(), any(), any());
  }

  // ── Task 5: create 시 참석자 Graph 전송 (#547) ────────────────────────────────

  /**
   * 외부 쓰기 캘린더 + 내부 멤버 1명 초대 → Graph createEvent 페이로드에 attendees 포함.
   *
   * <p>초대된 내부 사용자의 이메일이 GraphEventWrite.attendees 에 포함되는지 단언. AGENT·주최자 제외 규칙도 함께 검증.
   */
  @Test
  void create_on_external_calendar_sends_attendees_to_graph() {
    // 초대 대상: 알려진 이메일로 직접 삽입(email 값을 단언에 써야 하므로 inline 생성).
    long inviteeId =
        new TransactionTemplate(txManager)
            .execute(
                s -> {
                  long n = System.nanoTime();
                  return withMembership(
                      dsl.insertInto(USER)
                          .set(USER.USERNAME, "invitee-" + n)
                          .set(USER.NAME, "초대자")
                          .set(USER.EMAIL, "invitee-" + n + "@iacloud.kr")
                          .set(USER.PASSWORD, "pw")
                          .set(USER.KIND, UserKind.HUMAN)
                          .returning(USER.ID, USER.EMAIL)
                          .fetchOne()
                          .getId());
                });
    // 초대 대상 이메일 조회 — 단언용.
    String inviteeEmail =
        new TransactionTemplate(txManager)
            .execute(
                s ->
                    dsl.select(USER.EMAIL)
                        .from(USER)
                        .where(USER.ID.eq(inviteeId))
                        .fetchOne(USER.EMAIL));

    when(calendarTransport.createEvent(eq(ownerId), any(), eq("gcal-write"), any()))
        .thenReturn("EXT-ATTENDEE-1");

    CalendarEventRequest reqWithAttendee =
        new CalendarEventRequest(
            "외부 회의",
            null,
            OffsetDateTime.parse("2026-07-10T09:00:00Z"),
            OffsetDateTime.parse("2026-07-10T10:00:00Z"),
            false,
            null,
            null,
            null,
            null,
            List.of(inviteeId),
            extCalId);
    eventService.create(ownerId, reqWithAttendee);

    ArgumentCaptor<GraphEventWrite> body = ArgumentCaptor.forClass(GraphEventWrite.class);
    verify(calendarTransport).createEvent(eq(ownerId), any(), eq("gcal-write"), body.capture());
    // attendees 비어있지 않고 초대된 사용자의 이메일을 포함해야 함.
    assertThat(body.getValue().attendees()).isNotNull();
    assertThat(body.getValue().attendees())
        .anySatisfy(a -> assertThat(a.emailAddress().address()).isEqualTo(inviteeEmail));

    // 정리: 알림 디스패처 모킹으로 notification 행 없음 — 사용자만 제거.
    cleanupInTenant(TENANT_ID, () -> dsl.execute("DELETE FROM \"user\" WHERE id = ?", inviteeId));
  }

  /** 외부 쓰기 캘린더 + 참석자 없음 → attendees=null (Graph 페이로드에서 생략). 주최자만 있는 경우. */
  @Test
  void create_on_external_calendar_without_attendees_sends_null_attendees() {
    when(calendarTransport.createEvent(eq(ownerId), any(), eq("gcal-write"), any()))
        .thenReturn("EXT-NO-ATTENDEES");

    eventService.create(ownerId, req(extCalId, null));

    ArgumentCaptor<GraphEventWrite> body = ArgumentCaptor.forClass(GraphEventWrite.class);
    verify(calendarTransport).createEvent(eq(ownerId), any(), eq("gcal-write"), body.capture());
    // 참석자 없으면 null — @JsonInclude(NON_NULL) 에 의해 Graph 페이로드에서 생략.
    assertThat(body.getValue().attendees()).isNull();
  }

  /**
   * 로컬 캘린더 일정 생성 → transport 미호출(attendees 전송 없음).
   *
   * <p>참석자가 있더라도 로컬 캘린더면 Graph 로 전송하지 않는다.
   */
  @Test
  void create_on_local_calendar_does_not_send_attendees_to_graph() {
    long localCal = calendarRepo.insert(ownerId, "로컬캘", "teal", true, 2);
    CalendarEventRequest reqWithAttendee =
        new CalendarEventRequest(
            "로컬 회의",
            null,
            OffsetDateTime.parse("2026-07-10T09:00:00Z"),
            OffsetDateTime.parse("2026-07-10T10:00:00Z"),
            false,
            null,
            null,
            null,
            null,
            null, // attendeeUserIds=null → 빈 리스트 정규화
            localCal);
    eventService.create(ownerId, reqWithAttendee);
    verify(calendarTransport, never()).createEvent(anyLong(), any(), any(), any());
  }

  // ── 일정 저장 요청에 실린 태그 → Outlook 범주(WP-801) ─────────────────────────

  @Autowired CalendarTagService tagService;

  /** 이 테스트의 외부 쓰기 캘린더를 내 사서함 달력으로 — 그래야 태그를 Outlook 범주로 써 넣을 수 있다(tagsEditable). */
  private void markOwnMailbox() {
    new TransactionTemplate(txManager)
        .execute(
            s ->
                dsl.update(CALENDAR)
                    .set(CALENDAR.IS_OWN_MAILBOX, true)
                    .where(CALENDAR.ID.eq(extCalId))
                    .execute());
  }

  /** 같은 요청에 tagIds 만 바꿔 싣는다. */
  private static CalendarEventRequest withTags(CalendarEventRequest r, List<Long> tagIds) {
    return new CalendarEventRequest(
        r.title(),
        r.description(),
        r.startsAt(),
        r.endsAt(),
        r.allDay(),
        r.location(),
        r.color(),
        r.reminderMinutes(),
        r.recurrenceRule(),
        r.attendeeUserIds(),
        r.calendarId(),
        tagIds);
  }

  private static List<String> tagNames(CalendarEventResponse e) {
    return e.tags().stream().map(com.workplace.calendar.dto.CalendarTagRef::name).toList();
  }

  /** 단일 일정의 지금 범주 — 써 넣기 직전 읽기. */
  private void liveCategories(String externalId, List<String> categories) {
    when(calendarTransport.readCategories(eq(ownerId), any(), eq(externalId)))
        .thenReturn(new CalendarTransport.LiveCategories("singleInstance", null, categories));
  }

  /** M365 캘린더에 태그를 실어 만들면 Graph 에 일정을 만든 뒤(트랜잭션 밖) Outlook 범주를 써 넣고, 응답에 그 태그가 실린다. */
  @Test
  void create_external_withTagIds_writesOutlookCategories_afterCreate() {
    markOwnMailbox();
    long tagId = tagService.create(ownerId, new CalendarTagRequest("고객사", null)).id();
    when(calendarTransport.createEvent(eq(ownerId), any(), eq("gcal-write"), any()))
        .thenReturn("graph-evt-t1");
    liveCategories("graph-evt-t1", List.of());

    CalendarEventResponse created =
        eventService.create(ownerId, withTags(req(extCalId, null), List.of(tagId)));

    InOrder order = inOrder(calendarTransport);
    order.verify(calendarTransport).createEvent(eq(ownerId), any(), eq("gcal-write"), any());
    order
        .verify(calendarTransport)
        .updateCategories(eq(ownerId), any(), eq("graph-evt-t1"), eq(List.of("고객사")));
    assertThat(tagNames(created)).containsExactly("고객사");
  }

  /**
   * M365 일정 수정에 태그를 실으면 Graph PATCH(일정) 뒤 범주를 써 넣고 응답에 태그가 실린다. tagIds 를 보내지 않으면(MCP·AI) 범주를 읽지도
   * 않는다.
   */
  @Test
  void update_external_withTagIds_writesCategories_nullTagIdsSkips() {
    markOwnMailbox();
    long tagId = tagService.create(ownerId, new CalendarTagRequest("운영", null)).id();
    when(calendarTransport.createEvent(eq(ownerId), any(), eq("gcal-write"), any()))
        .thenReturn("graph-evt-t2");
    CalendarEventResponse created = eventService.create(ownerId, req(extCalId, null));

    eventService.update(
        ownerId, created.id(), req(extCalId, null), com.workplace.calendar.dto.EditScope.ALL, null);
    verify(calendarTransport, never()).readCategories(anyLong(), any(), any());

    liveCategories("graph-evt-t2", List.of("Outlook만"));
    CalendarEventResponse updated =
        eventService.update(
            ownerId,
            created.id(),
            withTags(req(extCalId, null), List.of(tagId)),
            com.workplace.calendar.dto.EditScope.ALL,
            null);

    InOrder order = inOrder(calendarTransport);
    order.verify(calendarTransport).updateEvent(eq(ownerId), any(), eq("graph-evt-t2"), any());
    order
        .verify(calendarTransport)
        .updateCategories(eq(ownerId), any(), eq("graph-evt-t2"), eq(List.of("Outlook만", "운영")));
    assertThat(tagNames(updated)).containsExactly("운영");
  }

  /** 범주를 써 넣을 수 없는 M365 일정(내 사서함 달력 아님)에 태그를 실으면 409 — Graph 에 일정 PATCH 도 보내지 않는다(사전검증). */
  @Test
  void update_external_withTagIds_notTaggable_conflictBeforeGraph() {
    long tagId = tagService.create(ownerId, new CalendarTagRequest("운영", null)).id();
    when(calendarTransport.createEvent(eq(ownerId), any(), eq("gcal-write"), any()))
        .thenReturn("graph-evt-t3");
    CalendarEventResponse created = eventService.create(ownerId, req(extCalId, null));

    assertThatThrownBy(
            () ->
                eventService.update(
                    ownerId,
                    created.id(),
                    withTags(req(extCalId, null), List.of(tagId)),
                    com.workplace.calendar.dto.EditScope.ALL,
                    null))
        .isInstanceOf(ExternalEventTagNotSupportedException.class);
    verify(calendarTransport, never()).updateEvent(anyLong(), any(), any(), any());
    verify(calendarTransport, never()).updateCategories(anyLong(), any(), any(), any());
  }

  /** 범주를 써 넣을 수 없는 M365 달력(내 사서함 아님)에 태그를 실어 만들면 409 — Graph 에 일정을 만들지도 않는다(사전검증). */
  @Test
  void create_external_withTagIds_notOwnMailbox_conflictBeforeGraph() {
    long tagId = tagService.create(ownerId, new CalendarTagRequest("운영", null)).id();

    assertThatThrownBy(
            () -> eventService.create(ownerId, withTags(req(extCalId, null), List.of(tagId))))
        .isInstanceOf(ExternalEventTagNotSupportedException.class);
    verify(calendarTransport, never()).createEvent(anyLong(), any(), any(), any());
  }

  /**
   * 새 M365 일정의 범주 써 넣기가 Graph 오류로 실패해도 생성은 성공으로 돌려준다 — 일정은 이미 Outlook 에 있어, 실패로 돌려주면 폼에서 다시 「저장」할 때
   * 같은 일정(과 초대 메일)이 하나 더 생긴다. 태그만 빠진 채 로컬 행이 남고 Graph 생성은 한 번이다.
   */
  @Test
  void create_external_withTagIds_categoriesFailure_stillReturnsCreatedEvent() {
    markOwnMailbox();
    long tagId = tagService.create(ownerId, new CalendarTagRequest("고객사", null)).id();
    when(calendarTransport.createEvent(eq(ownerId), any(), eq("gcal-write"), any()))
        .thenReturn("graph-evt-t4");
    liveCategories("graph-evt-t4", List.of());
    org.mockito.Mockito.doThrow(
            new ExternalCalendarWriteException("Graph 범주 쓰기 실패", new RuntimeException("503")))
        .when(calendarTransport)
        .updateCategories(eq(ownerId), any(), eq("graph-evt-t4"), anyList());

    CalendarEventResponse created =
        eventService.create(ownerId, withTags(req(extCalId, null), List.of(tagId)));

    verify(calendarTransport, org.mockito.Mockito.times(1))
        .createEvent(eq(ownerId), any(), eq("gcal-write"), any());
    assertThat(created.tags()).isEmpty();
    assertThat(eventService.get(ownerId, created.id()).title()).isEqualTo("회의");
  }

  /**
   * WP-1907 — 범주 써 넣기에서 M365 토큰을 읽지 못해도(전송기가 다시 연결 안내 예외를 그대로 내보낸다) 생성은 성공으로 돌려준다. 실패로 돌려주면 다시
   * 「저장」할 때 같은 일정(과 초대 메일)이 하나 더 생긴다.
   */
  @Test
  void create_external_withTagIds_tokenUnreadableOnCategories_stillReturnsCreatedEvent() {
    markOwnMailbox();
    long tagId = tagService.create(ownerId, new CalendarTagRequest("고객사", null)).id();
    when(calendarTransport.createEvent(eq(ownerId), any(), eq("gcal-write"), any()))
        .thenReturn("graph-evt-t5");
    liveCategories("graph-evt-t5", List.of());
    org.mockito.Mockito.doThrow(
            com.workplace.mail.exception.MailCredentialUnreadableException.oauthToken(null))
        .when(calendarTransport)
        .updateCategories(eq(ownerId), any(), eq("graph-evt-t5"), anyList());

    CalendarEventResponse created =
        eventService.create(ownerId, withTags(req(extCalId, null), List.of(tagId)));

    verify(calendarTransport, org.mockito.Mockito.times(1))
        .createEvent(eq(ownerId), any(), eq("gcal-write"), any());
    assertThat(created.tags()).isEmpty();
    assertThat(eventService.get(ownerId, created.id()).title()).isEqualTo("회의");
  }
}
