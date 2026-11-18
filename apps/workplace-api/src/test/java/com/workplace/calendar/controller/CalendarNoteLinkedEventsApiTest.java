package com.workplace.calendar.controller;

import static com.workplace.jooq.Tables.CALENDAR_EVENT_EXCEPTION;
import static com.workplace.jooq.Tables.EVENT_ATTENDEE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.authentication;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workplace.calendar.CalendarNoteTestBase;
import com.workplace.calendar.dto.CalendarEventRequest;
import com.workplace.calendar.dto.EditScope;
import com.workplace.global.tenant.TenantContext;
import com.workplace.wiki.dto.CreatePageRequest;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.request.RequestPostProcessor;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.node.ObjectNode;

/**
 * 노트에 이어진 일정 조회 HTTP(WP-1703) — {@code GET /api/v1/calendar/notes/{pageId}/events}. 볼 수 있는 일정만, 반복
 * 회차는 (마스터, 원래 시작 시각) 키와 override 시각, 더는 펼쳐지지 않는 회차는 빼고, 읽을 수 없는 노트는 없는 노트와 같은 404.
 */
class CalendarNoteLinkedEventsApiTest extends CalendarNoteTestBase {
  @Autowired MockMvc mvc;
  @Autowired ObjectMapper om;

  /** 사람 요청으로 꾸민다(읽기 권한만) — 요청마다 테넌트를 되돌려 놓는다. */
  private RequestPostProcessor as(long uid) {
    RequestPostProcessor auth =
        authentication(
            new UsernamePasswordAuthenticationToken(
                uid, "n/a", List.of(new SimpleGrantedAuthority("calendar:read"))));
    return req -> {
      TenantContext.set(1L);
      return auth.postProcessRequest(req);
    };
  }

  /** 제목·시작 시각·참석자를 정한 단일 일정(1시간). */
  private long single(long owner, String title, OffsetDateTime start, Long... attendees) {
    TenantContext.set(1L);
    return eventService
        .create(
            owner,
            new CalendarEventRequest(
                title,
                null,
                start,
                start.plusHours(1),
                false,
                null,
                null,
                null,
                null,
                List.of(attendees),
                null),
            false)
        .id();
  }

  /** 주간 반복 요청(전체·이 회차만 수정용). */
  private static CalendarEventRequest weeklyReq(String title, OffsetDateTime start) {
    return new CalendarEventRequest(
        title, null, start, start.plusHours(1), false, null, null, null, "FREQ=WEEKLY", null, null);
  }

  private int attendeeRows(long eventId) {
    return dsl.fetchCount(EVENT_ATTENDEE, EVENT_ATTENDEE.EVENT_ID.eq(eventId));
  }

  private JsonNode items(long caller, long pageId) throws Exception {
    MvcResult r =
        mvc.perform(get("/api/v1/calendar/notes/{pageId}/events", pageId).with(as(caller)))
            .andExpect(status().isOk())
            .andReturn();
    return om.readTree(r.getResponse().getContentAsString(StandardCharsets.UTF_8)).get("items");
  }

  private static Instant instant(JsonNode n) {
    return OffsetDateTime.parse(n.asString()).toInstant();
  }

  @Test
  void linkedEvents_listsVisibleEventWithTitleTimeAndAttendeeCount() throws Exception {
    long e = single(ownerA, "제품 회의", START, attendeeB);
    eventService.linkNote(ownerA, e, null, pShared);
    int expectedCount = attendeeRows(e);
    assertThat(expectedCount).isPositive();

    for (long caller : List.of(ownerA, attendeeB)) {
      JsonNode items = items(caller, pShared);
      assertThat(items).hasSize(1);
      JsonNode it = items.get(0);
      assertThat(it.get("eventId").asLong()).isEqualTo(e);
      assertThat(it.get("title").asString()).isEqualTo("제품 회의");
      assertThat(instant(it.get("startsAt"))).isEqualTo(START.toInstant());
      assertThat(instant(it.get("endsAt"))).isEqualTo(START.plusHours(1).toInstant());
      assertThat(it.get("allDay").asBoolean()).isFalse();
      assertThat(it.get("attendeeCount").asInt()).isEqualTo(expectedCount);
      // 키 자체는 있고 값이 null — 반복 아닌 일정.
      assertThat(it.has("occurrenceDate")).isTrue();
      assertThat(it.get("occurrenceDate").isNull()).isTrue();
      // 옮긴 회차가 아니면 overrideEventId 도 키는 있고 값이 null(WP-1703).
      assertThat(it.has("overrideEventId")).isTrue();
      assertThat(it.get("overrideEventId").isNull()).isTrue();
    }
  }

  @Test
  void linkedEvents_hidesEventsTheCallerCannotSee() throws Exception {
    long sp = spaceService.createTeamSpace(ownerA, "C 도 보는 공간-" + UUID.randomUUID()).id();
    spaceService.addMember(ownerA, sp, strangerC, "VIEWER");
    long page = pageService.create(ownerA, sp, new CreatePageRequest(null, "C 도 보는 노트")).id();
    long e = singleEvent(ownerA);
    eventService.linkNote(ownerA, e, null, page);

    assertThat(items(ownerA, page)).hasSize(1);
    assertThat(items(strangerC, page)).isEmpty();
  }

  @Test
  void linkedEvents_unreadablePage_404SameAsMissing() throws Exception {
    JsonNode unreadable = notFound(strangerC, pA);
    JsonNode missing = notFound(strangerC, Long.MAX_VALUE);
    assertThat(unreadable).isEqualTo(missing);
  }

  private JsonNode notFound(long caller, long pageId) throws Exception {
    MvcResult r =
        mvc.perform(get("/api/v1/calendar/notes/{pageId}/events", pageId).with(as(caller)))
            .andReturn();
    assertThat(r.getResponse().getStatus()).isEqualTo(404);
    JsonNode n = om.readTree(r.getResponse().getContentAsString(StandardCharsets.UTF_8));
    ObjectNode copy = (ObjectNode) n.deepCopy();
    for (String k : new ArrayList<>(copy.propertyNames())) {
      if (k.equals("timestamp") || k.equals("path")) copy.remove(k);
    }
    return copy;
  }

  @Test
  void linkedEvents_recurringOccurrence_usesMasterAndOriginalStart_andOverrideTime()
      throws Exception {
    OffsetDateTime occ2 = START.plusWeeks(1);
    long master = weeklyEvent(ownerA, attendeeB);
    eventService.linkNote(ownerA, master, occ2, pShared);

    JsonNode it = items(ownerA, pShared).get(0);
    assertThat(it.get("eventId").asLong()).isEqualTo(master);
    assertThat(it.get("occurrenceDate").asString()).isEqualTo("2026-11-25T01:00:00Z");
    assertThat(instant(it.get("startsAt"))).isEqualTo(occ2.toInstant());
    assertThat(instant(it.get("endsAt"))).isEqualTo(occ2.plusHours(1).toInstant());
    assertThat(it.get("attendeeCount").asInt()).isEqualTo(attendeeRows(master));
    // 옮기기 전 가상 회차는 override 가 없다 — 딥링크는 (마스터, 회차) 로 연다.
    assertThat(it.get("overrideEventId").isNull()).isTrue();

    // 그 회차만 1시간 옮기면 키는 그대로, 시각·제목은 override 것.
    eventService.update(
        ownerA, master, weeklyReq("옮긴 회의", occ2.plusHours(1)), EditScope.THIS, occ2);
    JsonNode items = items(attendeeB, pShared);
    assertThat(items).hasSize(1);
    JsonNode moved = items.get(0);
    assertThat(moved.get("eventId").asLong()).isEqualTo(master);
    assertThat(moved.get("occurrenceDate").asString()).isEqualTo("2026-11-25T01:00:00Z");
    assertThat(moved.get("title").asString()).isEqualTo("옮긴 회의");
    assertThat(instant(moved.get("startsAt"))).isEqualTo(occ2.plusHours(1).toInstant());
    assertThat(instant(moved.get("endsAt"))).isEqualTo(occ2.plusHours(2).toInstant());
    // 딥링크가 마스터가 아니라 옮긴 회차를 열도록 override 행 id 를 싣는다(WP-1703) — 일정 목록에 보이는 그 행이다.
    long overrideId = moved.get("overrideEventId").asLong();
    assertThat(overrideId).isNotEqualTo(master);
    assertThat(overrideRowOf(master)).isEqualTo(overrideId);
  }

  /** 마스터의 예외(override) 행이 가리키는 일정 id(WP-1703) — RLS 우회 dsl 로 직접 읽는다. */
  private Long overrideRowOf(long master) {
    return dsl.select(CALENDAR_EVENT_EXCEPTION.OVERRIDE_EVENT_ID)
        .from(CALENDAR_EVENT_EXCEPTION)
        .where(CALENDAR_EVENT_EXCEPTION.EVENT_ID.eq(master))
        .fetchOne(CALENDAR_EVENT_EXCEPTION.OVERRIDE_EVENT_ID);
  }

  /**
   * 옮긴 회차의 override 행을 호출자가 못 보면 그 줄은 통째로 빠진다(WP-1703) — 마스터 가상 회차로 되돌아가 보이지도, override 의 제목·id 가
   * 새지도 않는다. 일정 목록도 마스터 전개에서 그 회차를 건너뛰고 override 는 가시성으로 걸러 B 에게 그 회차가 없으니 같은 결과다.
   */
  @Test
  void linkedEvents_invisibleOverride_dropsLineWithoutLeaking() throws Exception {
    OffsetDateTime occ2 = START.plusWeeks(1);
    long master = weeklyEvent(ownerA, attendeeB);
    eventService.linkNote(ownerA, master, occ2, pShared);
    eventService.update(
        ownerA, master, weeklyReq("비공개로 옮긴 회의", occ2.plusHours(1)), EditScope.THIS, occ2);
    long overrideId = overrideRowOf(master);
    // B 를 override 행 참석자에서만 뺀다 — 마스터 참석자로는 남아 마스터는 계속 보인다.
    int removed =
        dsl.deleteFrom(EVENT_ATTENDEE)
            .where(EVENT_ATTENDEE.EVENT_ID.eq(overrideId))
            .and(EVENT_ATTENDEE.USER_ID.eq(attendeeB))
            .execute();
    assertThat(removed).isEqualTo(1);

    // 주인은 여전히 옮긴 회차를 본다.
    JsonNode ownerItems = items(ownerA, pShared);
    assertThat(ownerItems).hasSize(1);
    assertThat(ownerItems.get(0).get("overrideEventId").asLong()).isEqualTo(overrideId);

    // B 에겐 아무 줄도 없다 — 응답 어디에도 override id·제목이 없다.
    JsonNode bItems = items(attendeeB, pShared);
    assertThat(bItems).isEmpty();
  }

  @Test
  void linkedEvents_dropsLinkWhoseOccurrenceNoLongerExpands() throws Exception {
    long master = weeklyEvent(ownerA);
    eventService.linkNote(ownerA, master, START.plusWeeks(1), pA);
    assertThat(items(ownerA, pA)).hasSize(1);

    eventService.update(
        ownerA, master, weeklyReq("주간 회의", START.plusMinutes(30)), EditScope.ALL, null);

    assertThat(items(ownerA, pA)).isEmpty();
  }

  @Test
  void linkedEvents_dropsCancelledOccurrence() throws Exception {
    long master = weeklyEvent(ownerA);
    eventService.linkNote(ownerA, master, START.plusWeeks(1), pA);
    eventService.linkNote(ownerA, master, START.plusWeeks(2), pA);

    eventService.delete(ownerA, master, EditScope.THIS, START.plusWeeks(1));

    JsonNode items = items(ownerA, pA);
    assertThat(items).hasSize(1);
    assertThat(items.get(0).get("occurrenceDate").asString()).isEqualTo("2026-12-02T01:00:00Z");
  }

  @Test
  void linkedEvents_noLinks_emptyItems() throws Exception {
    mvc.perform(get("/api/v1/calendar/notes/{pageId}/events", pA).with(as(ownerA)))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.items").isArray())
        .andExpect(jsonPath("$.items").isEmpty());
  }

  @Test
  void linkedEvents_sortedByStartDescending() throws Exception {
    long early = single(ownerA, "이른 회의", START);
    long late = single(ownerA, "늦은 회의", START.plusDays(3));
    eventService.linkNote(ownerA, early, null, pA);
    eventService.linkNote(ownerA, late, null, pA);

    JsonNode items = items(ownerA, pA);
    assertThat(items).hasSize(2);
    assertThat(items.get(0).get("eventId").asLong()).isEqualTo(late);
    assertThat(items.get(1).get("eventId").asLong()).isEqualTo(early);
  }
}
