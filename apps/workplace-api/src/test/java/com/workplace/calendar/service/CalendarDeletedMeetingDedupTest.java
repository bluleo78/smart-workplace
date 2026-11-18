package com.workplace.calendar.service;

import static com.workplace.jooq.Tables.CALENDAR;
import static com.workplace.jooq.Tables.CALENDAR_DELETED_MEETING;
import static com.workplace.jooq.Tables.CALENDAR_EVENT;
import static com.workplace.jooq.Tables.EMAIL_ACCOUNT;
import static com.workplace.jooq.Tables.EVENT_ATTENDEE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;

import com.workplace.calendar.dto.CalendarEventRequest;
import com.workplace.calendar.dto.CalendarEventResponse;
import com.workplace.calendar.dto.EditScope;
import com.workplace.calendar.repository.ExternalCalendarRepository;
import com.workplace.calendar.repository.ExternalCalendarRepository.ExternalEventRow;
import com.workplace.global.security.EncryptionService;
import com.workplace.global.tenant.TenantContext;
import com.workplace.mail.dto.MailProvider;
import com.workplace.notify.outbound.NotificationDispatcher;
import com.workplace.support.ExternalClientMockedTestBase;
import com.workplace.support.TestFixtures;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.List;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 지운 동기화 미팅 기억 통합 테스트(WP-1734) — 내 동기화 사본을 지우면 같은 미팅(같은 iCalUID)의 동료·주최자 사본이 내 목록에 다시 나타나지 않는지, 다시
 * 초대받아 내 사본이 동기화되면 그 사본은 그대로 보이는지, iCalUID 없는 로컬 일정은 영향이 없는지 본다.
 *
 * <p>동기화 일정 삭제는 Graph DELETE 를 tx 밖에서 부르므로(ambient tx 면 409) {@code @Transactional} 롤백을 못 쓴다 —
 * write-through 테스트와 같은 목 조합(CalendarTransport·NotificationDispatcher)으로 컨텍스트를 같이 쓰고 끝나면 직접 지운다.
 */
class CalendarDeletedMeetingDedupTest extends ExternalClientMockedTestBase {

  @MockitoBean CalendarTransport calendarTransport;
  @MockitoBean NotificationDispatcher notificationDispatcher;

  @Autowired CalendarEventService eventService;
  @Autowired ExternalCalendarRepository extRepo;
  @Autowired DSLContext dsl;
  @Autowired EncryptionService encryption;

  private static final long TENANT_ID = 1L;
  // 보존 기간(미팅 끝 + 30일) 정리에 걸리지 않게 먼 미래로 둔다.
  private static final OffsetDateTime T = OffsetDateTime.parse("2027-07-10T09:00:00Z");

  private long me;
  private long accountId;
  private long extCalId;
  private final List<Long> users = new ArrayList<>();

  @BeforeEach
  void setUp() {
    TenantContext.set(TENANT_ID);
    inTx(
        () -> {
          me = newMember();
          accountId =
              dsl.insertInto(EMAIL_ACCOUNT)
                  .set(EMAIL_ACCOUNT.USER_ID, me)
                  .set(EMAIL_ACCOUNT.EMAIL_ADDRESS, me + "@iacloud.kr")
                  .set(EMAIL_ACCOUNT.PROVIDER, "M365_GRAPH")
                  .set(EMAIL_ACCOUNT.OAUTH_REFRESH_TOKEN, encryption.encrypt("RT"))
                  .set(EMAIL_ACCOUNT.OAUTH_ACCESS_TOKEN, encryption.encrypt("AT"))
                  .set(EMAIL_ACCOUNT.OAUTH_TOKEN_EXPIRES_AT, OffsetDateTime.now().plusHours(1))
                  .set(EMAIL_ACCOUNT.AI_ENABLED, false)
                  .set(EMAIL_ACCOUNT.TENANT_ID, TENANT_ID)
                  .returning(EMAIL_ACCOUNT.ID)
                  .fetchOne()
                  .getId();
          // 내 Outlook 동기화 달력(쓰기 가능)
          extCalId =
              dsl.insertInto(CALENDAR)
                  .set(CALENDAR.OWNER_ID, me)
                  .set(CALENDAR.NAME, "업무")
                  .set(CALENDAR.COLOR, "blue")
                  .set(CALENDAR.IS_DEFAULT, false)
                  .set(CALENDAR.POSITION, 0)
                  .set(CALENDAR.EXTERNAL_ACCOUNT_ID, accountId)
                  .set(CALENDAR.EXTERNAL_ID, "gcal-me")
                  .set(CALENDAR.IS_READ_ONLY, false)
                  .set(CALENDAR.TENANT_ID, TENANT_ID)
                  .returning(CALENDAR.ID)
                  .fetchOne()
                  .getId();
        });
    when(calendarTransport.provider()).thenReturn(MailProvider.M365_GRAPH);
  }

  @AfterEach
  void tearDown() {
    List<Long> all = new ArrayList<>(users);
    long aid = accountId;
    cleanupInTenant(
        TENANT_ID,
        () -> {
          dsl.deleteFrom(CALENDAR_DELETED_MEETING)
              .where(CALENDAR_DELETED_MEETING.USER_ID.in(all))
              .execute();
          dsl.deleteFrom(CALENDAR_EVENT).where(CALENDAR_EVENT.OWNER_ID.in(all)).execute();
          dsl.deleteFrom(CALENDAR).where(CALENDAR.OWNER_ID.in(all)).execute();
          dsl.deleteFrom(EMAIL_ACCOUNT).where(EMAIL_ACCOUNT.ID.eq(aid)).execute();
          for (long u : all) {
            dsl.execute("DELETE FROM \"user\" WHERE id = ?", u);
          }
        });
    users.clear();
    TenantContext.clear();
  }

  private void inTx(Runnable body) {
    new TransactionTemplate(txManager).executeWithoutResult(s -> body.run());
  }

  /** 테넌트#1 구성원 — 참석자 초대는 같은 워크스페이스 구성원만 받는다(#852). */
  private long newMember() {
    long id = withMembership(TestFixtures.createHuman(dsl));
    users.add(id);
    return id;
  }

  private CalendarEventRequest req(OffsetDateTime s, List<Long> attendees, Long calId) {
    return new CalendarEventRequest(
        "주간 회의", null, s, s.plusHours(1), false, null, null, null, null, attendees, calId);
  }

  private void stampIcalUid(long eventId, String uid) {
    inTx(
        () ->
            dsl.update(CALENDAR_EVENT)
                .set(CALENDAR_EVENT.ICAL_UID, uid)
                .where(CALENDAR_EVENT.ID.eq(eventId))
                .execute());
  }

  /** 내 Outlook 달력의 동기화 사본 — write-through 생성(Graph 목)으로 external_id 를 달고 iCalUID 를 스탬프한다. */
  private long myCopy(String externalId, String uid, OffsetDateTime s) {
    when(calendarTransport.createEvent(eq(me), any(), eq("gcal-me"), any())).thenReturn(externalId);
    long id = eventService.create(me, req(s, List.of(), extCalId)).id();
    stampIcalUid(id, uid);
    return id;
  }

  /**
   * 남(owner)의 달력에 있는 같은 미팅 사본 — owner 소유·me 참석자, 주최자(ORGANIZER 행)는 organizer. 동기화 사본은 주인이 참석자일 뿐
   * 주최자는 따로 실린다.
   */
  private long othersCopy(long owner, long organizer, String uid, OffsetDateTime s) {
    long id = eventService.create(owner, req(s, List.of(me), null)).id();
    inTx(
        () -> {
          // 내가 주최자면 내 참석자 행을 주최자 행으로 바꾼다(한 일정에 같은 사람 행은 하나).
          if (organizer == me) {
            dsl.deleteFrom(EVENT_ATTENDEE)
                .where(EVENT_ATTENDEE.EVENT_ID.eq(id))
                .and(EVENT_ATTENDEE.USER_ID.eq(me))
                .execute();
          }
          dsl.update(EVENT_ATTENDEE)
              .set(EVENT_ATTENDEE.USER_ID, organizer)
              .where(EVENT_ATTENDEE.EVENT_ID.eq(id))
              .and(EVENT_ATTENDEE.ROLE.eq("ORGANIZER"))
              .execute();
        });
    stampIcalUid(id, uid);
    return id;
  }

  private List<Long> listedIds() {
    return eventService.list(me, T.minusDays(1), T.plusDays(1)).stream()
        .map(CalendarEventResponse::id)
        .toList();
  }

  /**
   * (a) 주최자인 내가 반복 회의 한 회차(동기화 사본)를 지우면, 같은 회차의 동료 동기화 사본(동료 계정이 아직 동기화 전)이 내 목록에 나타나지 않는다. 다른
   * 회차(다른 iCalUID)의 동료 사본과 iCalUID 없는 로컬 초대는 그대로 보인다.
   */
  @Test
  void organizerDeletesOccurrence_colleagueCopyHidden() {
    long colleague = newMember();
    long mine = myCopy("graph-occ-1", "UID-OCC-1", T);
    long colleagueCopy = othersCopy(colleague, me, "UID-OCC-1", T);
    long nextOccurrenceCopy = othersCopy(colleague, me, "UID-OCC-2", T.plusHours(3));
    long localInvite = eventService.create(colleague, req(T, List.of(me), null)).id();
    assertThat(listedIds()).contains(mine).doesNotContain(colleagueCopy);

    eventService.delete(me, mine, EditScope.ALL, null);

    assertThat(listedIds())
        .doesNotContain(mine, colleagueCopy)
        .contains(nextOccurrenceCopy, localInvite);
  }

  /** (b) 참석자인 내가 동기화 미팅을 지우면, 주최자 Outlook 에 그대로 남는 주최자 사본이 내 목록에 나타나지 않는다. */
  @Test
  void attendeeDeletesMeeting_organizerCopyHidden() {
    long organizer = newMember();
    long mine = myCopy("graph-mtg-1", "UID-MTG-1", T);
    long organizerCopy = othersCopy(organizer, organizer, "UID-MTG-1", T);

    eventService.delete(me, mine, EditScope.ALL, null);

    assertThat(listedIds()).doesNotContain(mine, organizerCopy);
    // 기억은 (나, iCalUID, 미팅 끝 시각) 한 줄이다.
    var row =
        new TransactionTemplate(txManager)
            .execute(
                s ->
                    dsl.selectFrom(CALENDAR_DELETED_MEETING)
                        .where(CALENDAR_DELETED_MEETING.USER_ID.eq(me))
                        .fetchOne());
    assertThat(row).isNotNull();
    assertThat(row.getIcalUid()).isEqualTo("UID-MTG-1");
    assertThat(row.getEndsAt().toInstant()).isEqualTo(T.plusHours(1).toInstant());
  }

  /** (c) 지운 뒤 다시 초대받아 내 사본이 동기화로 돌아오면 그 사본은 그대로 보이고 남의 사본은 계속 가려진다. */
  @Test
  void myCopySyncedBack_showsNormally() {
    long organizer = newMember();
    long mine = myCopy("graph-mtg-2", "UID-MTG-2", T);
    long organizerCopy = othersCopy(organizer, organizer, "UID-MTG-2", T);
    eventService.delete(me, mine, EditScope.ALL, null);

    // 동기화 upsert 경로로 내 사본이 새 external_id 로 다시 들어온다(재초대·재수락).
    long resynced =
        new TransactionTemplate(txManager)
            .execute(
                s ->
                    extRepo
                        .upsertExternalEvent(
                            me,
                            extCalId,
                            "graph-mtg-2-again",
                            new ExternalEventRow(
                                "주간 회의",
                                null,
                                T,
                                T.plusHours(1),
                                false,
                                null,
                                "UID-MTG-2",
                                null,
                                null,
                                null))
                        .id());

    assertThat(listedIds()).contains(resynced).doesNotContain(organizerCopy);
  }

  /** (d) iCalUID 없는 로컬 일정을 지우면 기억을 남기지 않는다. */
  @Test
  void deletingLocalEvent_leavesNoMemory() {
    long local = eventService.create(me, req(T, List.of(), null)).id();

    eventService.delete(me, local, EditScope.ALL, null);

    Integer rows =
        new TransactionTemplate(txManager)
            .execute(
                s ->
                    dsl.fetchCount(
                        dsl.selectFrom(CALENDAR_DELETED_MEETING)
                            .where(CALENDAR_DELETED_MEETING.USER_ID.eq(me))));
    assertThat(rows).isZero();
  }
}
