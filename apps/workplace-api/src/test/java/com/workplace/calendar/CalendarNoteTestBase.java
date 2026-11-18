package com.workplace.calendar;

import static com.workplace.jooq.Tables.CALENDAR;
import static com.workplace.jooq.Tables.CALENDAR_EVENT;
import static com.workplace.jooq.Tables.CALENDAR_EVENT_NOTE;
import static com.workplace.jooq.Tables.EMAIL_ACCOUNT;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static com.workplace.jooq.Tables.WIKI_SPACE;

import com.workplace.calendar.dto.CalendarEventRequest;
import com.workplace.calendar.dto.CalendarEventResponse;
import com.workplace.calendar.repository.ExternalCalendarRepository;
import com.workplace.calendar.repository.ExternalCalendarRepository.ExternalEventRow;
import com.workplace.calendar.service.CalendarEventService;
import com.workplace.global.security.EncryptionService;
import com.workplace.global.tenant.TenantContext;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import com.workplace.wiki.dto.CreatePageRequest;
import com.workplace.wiki.service.WikiPageService;
import com.workplace.wiki.service.WikiSpaceService;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.springframework.beans.factory.annotation.Autowired;

/**
 * 일정 노트 연결 테스트 공용 시드(WP-1701) — 주인 A, 참석자 B, 낯선 사람 C 와 노트 두 개(A 만 보는 {@code pA}, A·B 가 보는 {@code
 * pShared}). 동시성·FK 경합을 보려고 비-@Transactional(커밋)이라 {@code @AfterEach} 에서 지운다.
 */
public abstract class CalendarNoteTestBase extends IntegrationTestBase {
  @Autowired protected DSLContext dsl;
  @Autowired protected CalendarEventService eventService;
  @Autowired protected WikiSpaceService spaceService;
  @Autowired protected WikiPageService pageService;
  @Autowired protected ExternalCalendarRepository extRepo;
  @Autowired protected EncryptionService encryption;

  /** 반복 회차 기준 시각(주간 반복의 첫 회차). */
  protected static final OffsetDateTime START = OffsetDateTime.parse("2026-11-18T01:00:00Z");

  protected long ownerA;
  protected long attendeeB;
  protected long strangerC;
  protected long pA;
  protected long pShared;
  private final List<Long> userIds = new ArrayList<>();
  private final List<Long> accountIds = new ArrayList<>();

  @BeforeEach
  void seedNoteBase() {
    TenantContext.set(1L);
    ownerA = seed();
    attendeeB = seed();
    strangerC = seed();
    long spA = spaceService.createTeamSpace(ownerA, "회의록A-" + UUID.randomUUID()).id();
    long spShared = spaceService.createTeamSpace(ownerA, "회의록공유-" + UUID.randomUUID()).id();
    spaceService.addMember(ownerA, spShared, attendeeB, "VIEWER");
    pA = pageService.create(ownerA, spA, new CreatePageRequest(null, "A 만 보는 노트")).id();
    pShared = pageService.create(ownerA, spShared, new CreatePageRequest(null, "공유 노트")).id();
  }

  @AfterEach
  void cleanupNoteBase() {
    cleanupInTenant(
        1L,
        () -> {
          dsl.deleteFrom(CALENDAR_EVENT).where(CALENDAR_EVENT.OWNER_ID.in(userIds)).execute();
          dsl.deleteFrom(CALENDAR).where(CALENDAR.OWNER_ID.in(userIds)).execute();
          dsl.deleteFrom(EMAIL_ACCOUNT).where(EMAIL_ACCOUNT.ID.in(accountIds)).execute();
          dsl.deleteFrom(WIKI_SPACE).where(WIKI_SPACE.OWNER_ID.in(userIds)).execute();
          dsl.deleteFrom(USER_ROLE).where(USER_ROLE.USER_ID.in(userIds)).execute();
          dsl.deleteFrom(USER).where(USER.ID.in(userIds)).execute();
        });
    userIds.clear();
    accountIds.clear();
    TenantContext.clear();
  }

  private long seed() {
    long id = TestFixtures.createHuman(dsl);
    userIds.add(id);
    return withMembership(id);
  }

  /** 단일 일정(주인=owner, 참석자 없음, 알림 없음). */
  protected long singleEvent(long owner) {
    return create(owner, null, List.of());
  }

  /** 매주 반복 일정(첫 회차 {@link #START}). 참석자 attendees 를 초대한다. */
  protected long weeklyEvent(long owner, Long... attendees) {
    return create(owner, "FREQ=WEEKLY", List.of(attendees));
  }

  private long create(long owner, String rrule, List<Long> attendees) {
    TenantContext.set(1L);
    CalendarEventResponse r =
        eventService.create(
            owner,
            new CalendarEventRequest(
                "주간 회의",
                null,
                START,
                START.plusHours(1),
                false,
                null,
                null,
                null,
                rrule,
                attendees,
                null),
            false);
    return r.id();
  }

  /** 노트 연결 줄 수(전체 표 — RLS 우회 dsl). */
  protected int noteRows(long eventId) {
    return dsl.fetchCount(CALENDAR_EVENT_NOTE, CALENDAR_EVENT_NOTE.EVENT_ID.eq(eventId));
  }

  /** 외부 달력 일정 한 건을 시드한다(주인 A). readOnly 면 읽기 전용 달력. */
  protected long seedExternalEvent(boolean readOnly, String extId) {
    TenantContext.set(1L);
    return callInTenant(
        1L,
        () -> {
          long accountId =
              dsl.insertInto(EMAIL_ACCOUNT)
                  .set(EMAIL_ACCOUNT.USER_ID, ownerA)
                  .set(
                      EMAIL_ACCOUNT.EMAIL_ADDRESS,
                      "note-link-" + extId + "-" + ownerA + "@test.local")
                  .set(EMAIL_ACCOUNT.DISPLAY_NAME, "노트 연결 테스트 계정")
                  .set(EMAIL_ACCOUNT.PROVIDER, "M365_GRAPH")
                  .set(EMAIL_ACCOUNT.OAUTH_REFRESH_TOKEN, encryption.encrypt("RT"))
                  .set(EMAIL_ACCOUNT.OAUTH_TOKEN_EXPIRES_AT, OffsetDateTime.now().plusHours(1))
                  .set(EMAIL_ACCOUNT.OAUTH_ACCESS_TOKEN, encryption.encrypt("FAKE_TOKEN"))
                  .set(EMAIL_ACCOUNT.AI_ENABLED, false)
                  .set(EMAIL_ACCOUNT.TENANT_ID, 1L)
                  .returning(EMAIL_ACCOUNT.ID)
                  .fetchOne()
                  .getId();
          accountIds.add(accountId);
          long calId =
              extRepo.upsertExternalCalendar(
                  ownerA, accountId, "cal-" + extId, "외부", "blue", readOnly, true);
          return extRepo.upsertExternalEvent(
              ownerA,
              calId,
              extId,
              new ExternalEventRow(
                  "외부 회의",
                  null,
                  START.plusWeeks(1),
                  START.plusWeeks(1).plusHours(1),
                  false,
                  null,
                  null,
                  null,
                  null,
                  null));
        });
  }
}
