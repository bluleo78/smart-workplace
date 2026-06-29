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

import com.workplace.calendar.repository.CalendarRepository;
import com.workplace.calendar.repository.EventAttendeeRepository;
import com.workplace.global.security.EncryptionService;
import com.workplace.global.tenant.TenantContext;
import com.workplace.mail.outbound.GraphCalendarClient;
import com.workplace.mail.outbound.GraphCalendarClient.GraphAttendeeWrite;
import com.workplace.mail.service.GraphTokenService;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.time.OffsetDateTime;
import java.util.List;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * invite/remove 오케스트레이터 + RSVP 가드 통합 테스트 — GraphCalendarClient 를 직접 모킹(CalendarTransport 미모킹). Task
 * 6 (#547).
 */
class CalendarEventExternalWriteTest extends IntegrationTestBase {

  @MockitoBean GraphCalendarClient graphCalendarClient;
  @MockitoBean GraphTokenService graphTokenService;

  @Autowired CalendarEventService eventService;
  @Autowired CalendarRepository calendarRepo;
  @Autowired EventAttendeeRepository attendeeRepo;
  @Autowired DSLContext dsl;
  @Autowired EncryptionService encryption;

  private static final long TENANT_ID = 1L;
  private long ownerId;
  private long accountId;

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
              return null;
            });
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

  /**
   * 외부 캘린더에 속한 일정 시드 — external_id="EXT-EVT", external account 연결, is_read_only=false.
   *
   * <p>txTemplate 안(또는 이미 활성 tx)에서 호출해야 RLS GUC 보장.
   */
  private long seedExternalEventOwnedBy(long ownerId) {
    long calId =
        dsl.insertInto(CALENDAR)
            .set(CALENDAR.OWNER_ID, ownerId)
            .set(CALENDAR.NAME, "외부캘린더")
            .set(CALENDAR.COLOR, "blue")
            .set(CALENDAR.IS_DEFAULT, false)
            .set(CALENDAR.POSITION, 0)
            .set(CALENDAR.EXTERNAL_ACCOUNT_ID, accountId)
            .set(CALENDAR.EXTERNAL_ID, "ext-cal-id")
            .set(CALENDAR.IS_READ_ONLY, false)
            .set(CALENDAR.TENANT_ID, TENANT_ID)
            .returning(CALENDAR.ID)
            .fetchOne()
            .getId();
    return dsl.insertInto(CALENDAR_EVENT)
        .set(CALENDAR_EVENT.OWNER_ID, ownerId)
        .set(CALENDAR_EVENT.CALENDAR_ID, calId)
        .set(CALENDAR_EVENT.TITLE, "외부일정")
        .set(CALENDAR_EVENT.STARTS_AT, OffsetDateTime.parse("2026-07-10T09:00:00Z"))
        .set(CALENDAR_EVENT.ENDS_AT, OffsetDateTime.parse("2026-07-10T10:00:00Z"))
        .set(CALENDAR_EVENT.ALL_DAY, false)
        .set(CALENDAR_EVENT.EXTERNAL_ID, "EXT-EVT")
        .set(CALENDAR_EVENT.TENANT_ID, TENANT_ID)
        .returning(CALENDAR_EVENT.ID)
        .fetchOne()
        .getId();
  }

  /**
   * 로컬 캘린더에 속한 일정 시드 — external_id 없음.
   *
   * <p>txTemplate 안(또는 이미 활성 tx)에서 호출해야 RLS GUC 보장.
   */
  private long seedLocalEventOwnedBy(long ownerId) {
    long calId = calendarRepo.insert(ownerId, "로컬캘린더", "green", true, 0);
    return dsl.insertInto(CALENDAR_EVENT)
        .set(CALENDAR_EVENT.OWNER_ID, ownerId)
        .set(CALENDAR_EVENT.CALENDAR_ID, calId)
        .set(CALENDAR_EVENT.TITLE, "로컬일정")
        .set(CALENDAR_EVENT.STARTS_AT, OffsetDateTime.parse("2026-07-10T09:00:00Z"))
        .set(CALENDAR_EVENT.ENDS_AT, OffsetDateTime.parse("2026-07-10T10:00:00Z"))
        .set(CALENDAR_EVENT.ALL_DAY, false)
        .set(CALENDAR_EVENT.TENANT_ID, TENANT_ID)
        .returning(CALENDAR_EVENT.ID)
        .fetchOne()
        .getId();
  }

  @Test
  void invite_on_external_organizer_event_patches_graph_with_full_list() {
    // 내가 주최한 외부 일정 + 기존 외부 참석자 1명, 새 내부 멤버 초대.
    long memberId =
        new TransactionTemplate(txManager)
            .execute(s -> TestFixtures.createHumanWithEmail(dsl, "newinvitee@iacloud.kr"));
    long eventId =
        new TransactionTemplate(txManager)
            .execute(
                s -> {
                  long e =
                      seedExternalEventOwnedBy(ownerId); // external_id="EXT-EVT", organizer=ownerId
                  attendeeRepo.insert(e, ownerId, null, "ORGANIZER", "ACCEPTED");
                  attendeeRepo.insertExternal(e, "old@guest.com", "Old", "ATTENDEE", "ACCEPTED");
                  return e;
                });
    when(graphTokenService.getAccessToken(anyLong(), anyLong())).thenReturn("tok");

    eventService.inviteAttendees(ownerId, eventId, List.of(memberId));

    @SuppressWarnings("unchecked")
    ArgumentCaptor<List<GraphAttendeeWrite>> cap = ArgumentCaptor.forClass(List.class);
    verify(graphCalendarClient).patchAttendees(eq("tok"), eq("EXT-EVT"), cap.capture());
    var emails = cap.getValue().stream().map(a -> a.emailAddress().address()).toList();
    assertThat(emails)
        .containsExactlyInAnyOrder("old@guest.com", "newinvitee@iacloud.kr"); // 전체 목록(주최자 제외)
    // 이벤트 삭제(→ event_attendee, notification CASCADE) 후 멤버 사용자 정리.
    final long eid = eventId;
    cleanupInTenant(
        TENANT_ID,
        () -> {
          dsl.deleteFrom(CALENDAR_EVENT).where(CALENDAR_EVENT.ID.eq(eid)).execute();
          dsl.execute("DELETE FROM \"user\" WHERE id = ?", memberId);
        });
  }

  @Test
  void invite_on_external_event_when_not_organizer_is_rejected() {
    long eventId =
        new TransactionTemplate(txManager)
            .execute(
                s -> {
                  long e = seedExternalEventOwnedBy(ownerId);
                  // 외부 조직자 — owner 는 ATTENDEE 일 뿐.
                  attendeeRepo.insertExternal(
                      e, "boss@partner.com", "Boss", "ORGANIZER", "ACCEPTED");
                  attendeeRepo.insert(e, ownerId, null, "ATTENDEE", "NEEDS_ACTION");
                  return e;
                });
    assertThatThrownBy(() -> eventService.inviteAttendees(ownerId, eventId, List.of(ownerId)))
        .isInstanceOf(
            com.workplace.calendar.exception.ExternalEventAttendeeNotOrganizerException.class);
    verify(graphCalendarClient, never()).patchAttendees(any(), any(), any());
  }

  @Test
  void invite_on_local_event_does_not_call_graph() {
    long eventId = new TransactionTemplate(txManager).execute(s -> seedLocalEventOwnedBy(ownerId));
    long memberId = new TransactionTemplate(txManager).execute(s -> TestFixtures.createHuman(dsl));
    eventService.inviteAttendees(ownerId, eventId, List.of(memberId));
    verify(graphCalendarClient, never()).patchAttendees(any(), any(), any());
    // 이벤트 삭제(→ event_attendee, notification CASCADE) 후 멤버 사용자 정리.
    final long eid = eventId;
    cleanupInTenant(
        TENANT_ID,
        () -> {
          dsl.deleteFrom(CALENDAR_EVENT).where(CALENDAR_EVENT.ID.eq(eid)).execute();
          dsl.execute("DELETE FROM \"user\" WHERE id = ?", memberId);
        });
  }

  @Test
  void rsvp_on_external_event_is_rejected() {
    long eventId =
        new TransactionTemplate(txManager)
            .execute(
                s -> {
                  long e = seedExternalEventOwnedBy(ownerId);
                  attendeeRepo.insert(e, ownerId, null, "ATTENDEE", "NEEDS_ACTION");
                  return e;
                });
    assertThatThrownBy(() -> eventService.respondRsvp(ownerId, eventId, "ACCEPTED"))
        .isInstanceOf(
            com.workplace.calendar.exception.ExternalEventRsvpNotSupportedException.class);
  }

  @Test
  void remove_on_external_organizer_event_patches_graph_without_removed_user() {
    // 내가 주최한 외부 일정에서 참석자를 제거하면 Graph 에 제거 후 전체 목록 패치.
    long removeeId =
        new TransactionTemplate(txManager)
            .execute(s -> TestFixtures.createHumanWithEmail(dsl, "toberemoved@iacloud.kr"));
    long eventId =
        new TransactionTemplate(txManager)
            .execute(
                s -> {
                  long e = seedExternalEventOwnedBy(ownerId);
                  attendeeRepo.insert(e, ownerId, null, "ORGANIZER", "ACCEPTED");
                  attendeeRepo.insert(e, removeeId, null, "ATTENDEE", "NEEDS_ACTION");
                  return e;
                });
    when(graphTokenService.getAccessToken(anyLong(), anyLong())).thenReturn("tok");

    eventService.removeAttendee(ownerId, eventId, removeeId);

    @SuppressWarnings("unchecked")
    ArgumentCaptor<java.util.List<GraphAttendeeWrite>> cap =
        ArgumentCaptor.forClass(java.util.List.class);
    verify(graphCalendarClient).patchAttendees(eq("tok"), eq("EXT-EVT"), cap.capture());
    var emails = cap.getValue().stream().map(a -> a.emailAddress().address()).toList();
    assertThat(emails).doesNotContain("toberemoved@iacloud.kr");
    // 이벤트 삭제(→ event_attendee CASCADE) 후 제거된 사용자 정리.
    final long eid = eventId;
    cleanupInTenant(
        TENANT_ID,
        () -> {
          dsl.deleteFrom(CALENDAR_EVENT).where(CALENDAR_EVENT.ID.eq(eid)).execute();
          dsl.execute("DELETE FROM \"user\" WHERE id = ?", removeeId);
        });
  }

  @Test
  void remove_on_external_event_when_not_organizer_is_rejected() {
    // 외부 조직자가 별도 있을 때 주최자가 아닌 ownerId 가 제거 시도하면 거부.
    long removeeId =
        new TransactionTemplate(txManager)
            .execute(s -> TestFixtures.createHumanWithEmail(dsl, "someuser@iacloud.kr"));
    long eventId =
        new TransactionTemplate(txManager)
            .execute(
                s -> {
                  long e = seedExternalEventOwnedBy(ownerId);
                  attendeeRepo.insertExternal(
                      e, "boss@partner.com", "Boss", "ORGANIZER", "ACCEPTED");
                  attendeeRepo.insert(e, ownerId, null, "ATTENDEE", "NEEDS_ACTION");
                  attendeeRepo.insert(e, removeeId, null, "ATTENDEE", "NEEDS_ACTION");
                  return e;
                });
    assertThatThrownBy(() -> eventService.removeAttendee(ownerId, eventId, removeeId))
        .isInstanceOf(
            com.workplace.calendar.exception.ExternalEventAttendeeNotOrganizerException.class);
    verify(graphCalendarClient, never()).patchAttendees(any(), any(), any());
    final long eid = eventId;
    cleanupInTenant(
        TENANT_ID,
        () -> {
          dsl.deleteFrom(CALENDAR_EVENT).where(CALENDAR_EVENT.ID.eq(eid)).execute();
          dsl.execute("DELETE FROM \"user\" WHERE id = ?", removeeId);
        });
  }

  @Test
  void remove_agent_on_external_event_does_not_call_graph() {
    // AGENT 참석자는 로컬 DB 에서만 제거되며 Graph patchAttendees 를 호출하지 않는다.
    long agentId =
        new TransactionTemplate(txManager)
            .execute(
                s ->
                    dsl.insertInto(com.workplace.jooq.Tables.USER)
                        .set(com.workplace.jooq.Tables.USER.USERNAME, "__assistant_u" + ownerId)
                        .set(
                            com.workplace.jooq.Tables.USER.EMAIL, "agent" + ownerId + "@iacloud.kr")
                        .set(com.workplace.jooq.Tables.USER.NAME, "AI")
                        .set(com.workplace.jooq.Tables.USER.PASSWORD, "x")
                        .set(com.workplace.jooq.Tables.USER.IS_ACTIVE, true)
                        .set(com.workplace.jooq.Tables.USER.KIND, "AGENT")
                        .returning(com.workplace.jooq.Tables.USER.ID)
                        .fetchOne(com.workplace.jooq.Tables.USER.ID));
    long eventId =
        new TransactionTemplate(txManager)
            .execute(
                s -> {
                  long e = seedExternalEventOwnedBy(ownerId);
                  attendeeRepo.insert(e, ownerId, null, "ORGANIZER", "ACCEPTED");
                  attendeeRepo.insert(e, agentId, null, "ATTENDEE", "ACCEPTED");
                  return e;
                });

    eventService.removeAttendee(ownerId, eventId, agentId);

    verify(graphCalendarClient, never()).patchAttendees(any(), any(), any());
    final long eid = eventId;
    cleanupInTenant(
        TENANT_ID,
        () -> {
          dsl.deleteFrom(CALENDAR_EVENT).where(CALENDAR_EVENT.ID.eq(eid)).execute();
          dsl.execute("DELETE FROM \"user\" WHERE id = ?", agentId);
        });
  }
}
