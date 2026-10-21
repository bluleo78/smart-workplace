package com.workplace.calendar;

import static com.workplace.jooq.Tables.CALENDAR;
import static com.workplace.jooq.Tables.CALENDAR_EVENT;
import static com.workplace.jooq.Tables.CALENDAR_EVENT_TAG;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.head;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workplace.calendar.dto.CalendarEventRequest;
import com.workplace.calendar.dto.CalendarTagRequest;
import com.workplace.calendar.dto.EditScope;
import com.workplace.calendar.dto.TagFeedResponse;
import com.workplace.calendar.exception.CalendarTagNotFoundException;
import com.workplace.calendar.exception.TagFeedNotFoundException;
import com.workplace.calendar.service.CalendarEventService;
import com.workplace.calendar.service.CalendarTagFeedService;
import com.workplace.calendar.service.CalendarTagService;
import com.workplace.global.tenant.TenantContext;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.nio.charset.StandardCharsets;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.UUID;
import java.util.function.Supplier;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 태그 구독 주소(WP-715) 통합 테스트 — 발급·재발급·폐기와, 로그인 없는 공개 .ics 요청(주 경계 KST·반복 전개·고친 회차 UID·종일 날짜·설명 제외·사람
 * 이메일·이스케이프).
 *
 * <p>{@code StagedUploadIntegrationTest} 처럼 일부러 {@code @Transactional} 을 달지 않는다 — 공개 요청에는 테넌트 컨텍스트가
 * 없다는 실제 조건(토큰 resolve 가 SECURITY DEFINER 함수로 RLS 를 우회해야 하는 이유)을 보려면 시드를 커밋해야 한다. 정리는 {@link
 * #cleanup}.
 */
class PublicCalendarFeedIntegrationTest extends IntegrationTestBase {
  @Autowired MockMvc mockMvc;
  @Autowired DSLContext dsl;
  @Autowired CalendarEventService events;
  @Autowired CalendarTagService tags;
  @Autowired CalendarTagFeedService feeds;

  private static final String BASE = "http://localhost:6173";
  private static final String WEEK = "2026-W43"; // 2026-10-19(월) ~ 10-26(월) KST

  private final List<Long> userIds = new ArrayList<>();
  private long owner;
  private String ownerEmail;
  private long guest;
  private String guestEmail;
  private long tagId;

  /** 테넌트 1 컨텍스트에서 트랜잭션으로 실행하고 컨텍스트를 지운다(공개 요청은 컨텍스트 없이 들어온다). */
  private <T> T inTenant(Supplier<T> work) {
    TenantContext.set(1L);
    try {
      return new TransactionTemplate(txManager).execute(s -> work.get());
    } finally {
      TenantContext.clear();
    }
  }

  private long seedUser(String prefix) {
    String t = UUID.randomUUID().toString().replace("-", "").substring(0, 8);
    long id =
        withMembership(
            dsl.insertInto(USER)
                .set(USER.USERNAME, prefix + "_" + t)
                .set(USER.PASSWORD, "pw")
                .set(USER.NAME, prefix + " " + t)
                .set(USER.EMAIL, prefix + "_" + t + "@example.com")
                .set(USER.KIND, "HUMAN")
                .returning(USER.ID)
                .fetchOne()
                .getId());
    userIds.add(id);
    return id;
  }

  private long event(
      String title,
      String description,
      String start,
      String end,
      boolean allDay,
      String rrule,
      List<Long> attendees) {
    return events
        .create(
            owner,
            new CalendarEventRequest(
                title,
                description,
                OffsetDateTime.parse(start),
                OffsetDateTime.parse(end),
                allDay,
                "회의실 A",
                null,
                null,
                rrule,
                attendees,
                null))
        .id();
  }

  @BeforeEach
  void seed() {
    inTenant(
        () -> {
          owner = seedUser("owner");
          guest = seedUser("guest");
          ownerEmail =
              dsl.select(USER.EMAIL).from(USER).where(USER.ID.eq(owner)).fetchOne(USER.EMAIL);
          guestEmail =
              dsl.select(USER.EMAIL).from(USER).where(USER.ID.eq(guest)).fetchOne(USER.EMAIL);
          tagId = tags.create(owner, new CalendarTagRequest("사내 공유", null)).id();
          return null;
        });
  }

  @AfterEach
  void cleanup() {
    cleanupInTenant(
        1L,
        () -> {
          dsl.deleteFrom(CALENDAR_EVENT).where(CALENDAR_EVENT.OWNER_ID.in(userIds)).execute();
          dsl.deleteFrom(CALENDAR).where(CALENDAR.OWNER_ID.in(userIds)).execute();
          // 사용자 삭제가 태그·멤버십을 FK CASCADE 로 함께 지운다.
          dsl.deleteFrom(USER).where(USER.ID.in(userIds)).execute();
        });
    userIds.clear();
  }

  private String issue() {
    TagFeedResponse feed = inTenant(() -> feeds.create(owner, tagId));
    assertThat(feed.url()).startsWith(BASE + "/api/v1/public/calendar/feeds/").endsWith(".ics");
    return feed.url().substring(BASE.length());
  }

  private ResultActions fetch(String path, String week) throws Exception {
    var req = get(path).accept("text/calendar");
    if (week != null) req = req.param("week", week);
    return mockMvc.perform(req);
  }

  private String body(String path, String week) throws Exception {
    return fetch(path, week)
        .andExpect(status().isOk())
        .andExpect(header().string("Content-Type", "text/calendar;charset=UTF-8"))
        .andExpect(header().string("Cache-Control", "no-store"))
        .andReturn()
        .getResponse()
        .getContentAsString(StandardCharsets.UTF_8);
  }

  /** 접힌 줄을 펼친 논리 줄 목록. */
  private static List<String> unfold(String ics) {
    return Arrays.asList(ics.replace("\r\n ", "").split("\r\n"));
  }

  /** 한 주치 내용 — 주 경계(KST), 반복 회차·고친 회차 UID, 종일 날짜(앱·M365), 설명 제외, 사람 이메일, 이스케이프, 태그 없는 일정 제외. */
  @Test
  void feed_exportsTaggedEventsOfTheWeek() throws Exception {
    long[] ids =
        inTenant(
            () -> {
              // 단일 — 설명이 있어도 내보내지 않는다. 쉼표·세미콜론 이스케이프.
              long single =
                  event(
                      "보고, 회의; 준비",
                      "비밀 설명",
                      "2026-10-21T01:00:00Z",
                      "2026-10-21T02:00:00Z",
                      false,
                      null,
                      List.of(guest));
              // 매일 반복(10-17 ~ 10-26, 09:00 KST) — 이 주에는 10-19 ~ 10-25 의 7회
              long daily =
                  event(
                      "데일리",
                      null,
                      "2026-10-17T00:00:00Z",
                      "2026-10-17T00:30:00Z",
                      false,
                      "FREQ=DAILY;COUNT=10",
                      List.of());
              // 앱 종일(KST 10-22) — 한국 자정으로 저장된다
              long appAllDay =
                  event(
                      "워크숍",
                      null,
                      "2026-10-21T15:00:00Z",
                      "2026-10-22T15:00:00Z",
                      true,
                      null,
                      List.of());
              // 주 경계: 일요일 23:30 KST(밖), 월요일 00:30 KST(안 — UTC 로는 일요일), 다음 월요일 00:00 KST(밖)
              long sundayNight =
                  event(
                      "일요일 밤",
                      null,
                      "2026-10-18T14:30:00Z",
                      "2026-10-18T14:50:00Z",
                      false,
                      null,
                      List.of());
              long mondayEarly =
                  event(
                      "월요일 새벽",
                      null,
                      "2026-10-18T15:30:00Z",
                      "2026-10-18T16:00:00Z",
                      false,
                      null,
                      List.of());
              long nextMonday =
                  event(
                      "다음 주",
                      null,
                      "2026-10-25T15:00:00Z",
                      "2026-10-25T16:00:00Z",
                      false,
                      null,
                      List.of());
              // 태그 없는 일정 — 나가지 않는다
              event(
                  "태그 없음",
                  null,
                  "2026-10-20T03:00:00Z",
                  "2026-10-20T04:00:00Z",
                  false,
                  null,
                  List.of());
              // M365 종일(UTC 자정 저장, 10-23) — 앱에서 태그를 못 붙이므로 동기화가 만든 OUTLOOK 연결을 직접 넣는다
              long m365 =
                  event(
                      "M365 종일",
                      null,
                      "2026-10-23T00:00:00Z",
                      "2026-10-24T00:00:00Z",
                      true,
                      null,
                      List.of());
              dsl.update(CALENDAR_EVENT)
                  .set(CALENDAR_EVENT.EXTERNAL_ID, "graph-evt-1")
                  .set(CALENDAR_EVENT.ICAL_UID, "040000008200E00074C5B7101A82E008-test")
                  .where(CALENDAR_EVENT.ID.eq(m365))
                  .execute();
              for (long id :
                  new long[] {single, daily, appAllDay, sundayNight, mondayEarly, nextMonday}) {
                tags.setEventTags(owner, id, List.of(tagId));
              }
              dsl.insertInto(CALENDAR_EVENT_TAG)
                  .set(CALENDAR_EVENT_TAG.TAG_ID, tagId)
                  .set(CALENDAR_EVENT_TAG.EVENT_ID, m365)
                  .set(CALENDAR_EVENT_TAG.SOURCE, "OUTLOOK")
                  .execute();
              // 10-20 회차만 11:00 KST 로 고친다 → 오버라이드 일정은 원래 회차의 UID 를 쓴다
              OffsetDateTime occ = OffsetDateTime.parse("2026-10-20T00:00:00Z");
              long override =
                  events
                      .update(
                          owner,
                          daily,
                          new CalendarEventRequest(
                              "데일리(변경)",
                              null,
                              occ.plusHours(2),
                              occ.plusHours(3),
                              false,
                              null,
                              null,
                              null,
                              null,
                              null,
                              null),
                          EditScope.THIS,
                          occ)
                      .id();
              return new long[] {single, daily, override};
            });
    long single = ids[0];
    long daily = ids[1];

    String ics = body(issue(), WEEK);
    List<String> lines = unfold(ics);

    assertThat(ics).startsWith("BEGIN:VCALENDAR\r\nVERSION:2.0\r\n").endsWith("END:VCALENDAR\r\n");
    assertThat(lines).contains("CALSCALE:GREGORIAN", "X-WR-CALNAME:사내 공유");
    assertThat(ics).doesNotContain("DESCRIPTION").doesNotContain("비밀 설명");
    // 물리 줄은 모두 75옥텟 이하
    for (String physical : ics.split("\r\n")) {
      assertThat(physical.getBytes(StandardCharsets.UTF_8).length).isLessThanOrEqualTo(75);
    }

    // 단일 일정
    assertThat(lines)
        .contains(
            "UID:wp-event-" + single + "@genia-works",
            "SUMMARY:보고\\, 회의\\; 준비",
            "LOCATION:회의실 A",
            "DTSTART:20261021T010000Z",
            "DTEND:20261021T020000Z");
    assertThat(lines)
        .anyMatch(l -> l.startsWith("ORGANIZER;") && l.endsWith(":mailto:" + ownerEmail));
    assertThat(lines)
        .anyMatch(
            l ->
                l.startsWith("ATTENDEE;")
                    && l.contains("PARTSTAT=NEEDS-ACTION")
                    && l.endsWith(":mailto:" + guestEmail));

    // 반복 — 7회 중 10-20 은 고친 회차(원래 회차 UID, 바뀐 시각), 나머지 6회는 가상 회차
    long dailyUids =
        lines.stream().filter(l -> l.startsWith("UID:wp-event-" + daily + "-")).count();
    assertThat(dailyUids).isEqualTo(7);
    assertThat(lines)
        .contains(
            "UID:wp-event-" + daily + "-20261019T000000Z@genia-works",
            "UID:wp-event-" + daily + "-20261020T000000Z@genia-works",
            "UID:wp-event-" + daily + "-20261025T000000Z@genia-works",
            "SUMMARY:데일리(변경)",
            "DTSTART:20261020T020000Z");
    assertThat(lines).doesNotContain("UID:wp-event-" + daily + "-20261026T000000Z@genia-works");

    // 종일 — 앱(KST 자정 저장)·M365(UTC 자정 저장) 모두 의도한 날짜
    assertThat(lines)
        .contains(
            "DTSTART;VALUE=DATE:20261022",
            "DTEND;VALUE=DATE:20261023",
            "UID:040000008200E00074C5B7101A82E008-test",
            "DTSTART;VALUE=DATE:20261023",
            "DTEND;VALUE=DATE:20261024");

    // 주 경계(KST)와 태그 없는 일정
    assertThat(lines).contains("SUMMARY:월요일 새벽");
    assertThat(lines).doesNotContain("SUMMARY:일요일 밤", "SUMMARY:다음 주", "SUMMARY:태그 없음");

    // 이 주에 나간 일정 수: 단일 1 + 반복 7 + 앱 종일 1 + 월요일 새벽 1 + M365 1 = 11
    assertThat(lines.stream().filter("BEGIN:VEVENT"::equals).count()).isEqualTo(11);
  }

  /**
   * 태그 없는 일정이 많아도 피드에는 태그 붙은 일정만 나간다 — 피드는 태그가 붙은 일정(+그 마스터의 고친 회차)만 읽어 펼친다(WP-715 리뷰). 태그 없는 반복
   * 일정·단일 일정이 섞여 있어도 결과는 태그 붙은 반복 일정의 이 주 회차뿐이다.
   */
  @Test
  void feed_readsOnlyTaggedEvents_amongManyUntagged() throws Exception {
    long tagged =
        inTenant(
            () -> {
              for (int i = 0; i < 30; i++) {
                event(
                    "태그 없음 " + i,
                    null,
                    "2026-10-20T0" + (i % 9) + ":00:00Z",
                    "2026-10-20T0" + (i % 9) + ":30:00Z",
                    false,
                    i % 3 == 0 ? "FREQ=DAILY;COUNT=20" : null,
                    List.of());
              }
              long weekly =
                  event(
                      "주간 회의",
                      null,
                      "2026-10-06T01:00:00Z",
                      "2026-10-06T02:00:00Z",
                      false,
                      "FREQ=WEEKLY;COUNT=5",
                      List.of());
              tags.setEventTags(owner, weekly, List.of(tagId));
              return weekly;
            });

    List<String> lines = unfold(body(issue(), WEEK));
    assertThat(lines.stream().filter("BEGIN:VEVENT"::equals).count()).isEqualTo(1);
    assertThat(lines)
        .contains("SUMMARY:주간 회의", "UID:wp-event-" + tagged + "-20261020T010000Z@genia-works");
    assertThat(lines).noneMatch(l -> l.startsWith("SUMMARY:태그 없음"));
  }

  /**
   * HEAD 도 로그인 없이 열린다(구독 클라이언트·프록시의 사전 확인) — 200 과 같은 Content-Type. 본문을 버리는 것은 서블릿 컨테이너(Tomcat)의
   * HEAD 처리라 MockMvc 는 본문을 그대로 돌려준다 — 그래서 여기서는 본문을 단언하지 않는다.
   */
  @Test
  void head_isPublic() throws Exception {
    mockMvc
        .perform(head(issue()).param("week", WEEK))
        .andExpect(status().isOk())
        .andExpect(header().string("Content-Type", "text/calendar;charset=UTF-8"));
  }

  /** 재발급하면 이전 주소는 바로 404, 폐기하면 새 주소도 404. 주소 없는 태그 조회는 404. week 없이 부르면 이번 주(200). */
  @Test
  void regenerateAndDelete_invalidateOldUrls() throws Exception {
    String first = issue();
    body(first, null);
    String second = issue();
    assertThat(second).isNotEqualTo(first);
    fetch(first, WEEK).andExpect(status().isNotFound());
    body(second, WEEK);

    TagFeedResponse current = inTenant(() -> feeds.get(owner, tagId));
    assertThat(current.url()).isEqualTo(BASE + second);

    inTenant(
        () -> {
          feeds.delete(owner, tagId);
          return null;
        });
    fetch(second, WEEK).andExpect(status().isNotFound());
    assertThatThrownBy(() -> inTenant(() -> feeds.get(owner, tagId)))
        .isInstanceOf(TagFeedNotFoundException.class);
  }

  /** 형식이 틀린 주는 400, 없는 토큰·형식이 틀린 토큰은 404 — Accept: text/calendar 여도 상태 코드가 그대로 나간다. */
  @Test
  void badWeek400_unknownToken404() throws Exception {
    String path = issue();
    fetch(path, "2026-43").andExpect(status().isBadRequest());
    fetch(path, "2025-W53").andExpect(status().isBadRequest());
    fetch("/api/v1/public/calendar/feeds/" + "A".repeat(43) + ".ics", WEEK)
        .andExpect(status().isNotFound());
    fetch("/api/v1/public/calendar/feeds/short.ics", WEEK).andExpect(status().isNotFound());
  }

  /** 남의 태그 구독 주소는 발급·조회·폐기할 수 없다(404). */
  @Test
  void otherUsersTag_isNotFound() {
    assertThatThrownBy(() -> inTenant(() -> feeds.create(guest, tagId)))
        .isInstanceOf(CalendarTagNotFoundException.class);
    assertThatThrownBy(() -> inTenant(() -> feeds.get(guest, tagId)))
        .isInstanceOf(CalendarTagNotFoundException.class);
  }

  /** 태그 주인이 워크스페이스에서 정지되면 주소가 막힌다(404). */
  @Test
  void suspendedOwner_feedIsNotFound() throws Exception {
    String path = issue();
    inTenant(
        () -> {
          TestFixtures.suspendMember(dsl, owner, 1L);
          return null;
        });
    fetch(path, WEEK).andExpect(status().isNotFound());
  }
}
