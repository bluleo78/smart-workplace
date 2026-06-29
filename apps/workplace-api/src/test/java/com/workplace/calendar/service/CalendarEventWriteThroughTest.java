package com.workplace.calendar.service;

import static com.workplace.jooq.Tables.CALENDAR;
import static com.workplace.jooq.Tables.CALENDAR_EVENT;
import static com.workplace.jooq.Tables.EMAIL_ACCOUNT;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.workplace.calendar.dto.CalendarEventRequest;
import com.workplace.calendar.dto.CalendarEventResponse;
import com.workplace.calendar.exception.ExternalCalendarWriteException;
import com.workplace.calendar.exception.ExternalCalendarWriteInTransactionException;
import com.workplace.calendar.exception.RecurringNotSupportedOnExternalCalendarException;
import com.workplace.calendar.repository.CalendarRepository;
import com.workplace.global.security.EncryptionService;
import com.workplace.global.tenant.TenantContext;
import com.workplace.mail.outbound.GraphCalendarClient.GraphEventWrite;
import com.workplace.mail.service.GraphTokenService;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.time.OffsetDateTime;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.transaction.support.TransactionTemplate;

/** create/update/delete write-through 통합 테스트 — CalendarTransport·GraphTokenService 를 모킹한다. */
class CalendarEventWriteThroughTest extends IntegrationTestBase {

  @MockitoBean CalendarTransport calendarTransport;
  @MockitoBean GraphTokenService graphTokenService;

  @Autowired CalendarEventService eventService;
  @Autowired CalendarRepository calendarRepo;
  @Autowired DSLContext dsl;
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
}
