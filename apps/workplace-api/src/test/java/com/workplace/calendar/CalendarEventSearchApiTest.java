package com.workplace.calendar;

import static com.workplace.calendar.CalendarSearchFixtures.insertAttendee;
import static com.workplace.calendar.CalendarSearchFixtures.insertCalendar;
import static com.workplace.calendar.CalendarSearchFixtures.insertEvent;
import static com.workplace.calendar.CalendarSearchFixtures.insertException;
import static com.workplace.jooq.Tables.CALENDAR_EVENT;
import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.hasSize;
import static org.hamcrest.Matchers.nullValue;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.authentication;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.global.tenant.TenantContext;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.time.temporal.ChronoUnit;
import java.util.List;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.RequestPostProcessor;
import org.springframework.transaction.annotation.Transactional;

/**
 * 일정 키워드 검색 API(WP-1357) — 정렬(다가오는 순 → 지난 순)·반복 일정 한 줄·동료 사본 한 줄·페이지·빈 검색어·인증. 지금 시각 기준 상대 날짜로 시드해
 * 결정적이다.
 */
@Transactional
class CalendarEventSearchApiTest extends IntegrationTestBase {

  @Autowired MockMvc mvc;
  @Autowired DSLContext dsl;

  long me;
  long cal;
  // 초 단위로 자른다 — 회차 전개기가 밀리초 정밀도라 예외 회차 시각(occurrence_date)을 정확히 맞추려면 마이크로초가 없어야 한다.
  final OffsetDateTime now = OffsetDateTime.now().truncatedTo(ChronoUnit.SECONDS);

  @BeforeEach
  void seed() {
    TenantContext.set(1L);
    me = TestFixtures.createHuman(dsl);
    cal = insertCalendar(dsl, me);
  }

  /** 사람 요청으로 꾸민다(요청마다 테넌트를 되돌려 놓는다). */
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

  @Test
  @DisplayName("다가오는_일정이_먼저_지난_일정은_뒤")
  void 다가오는_일정이_먼저_지난_일정은_뒤() throws Exception {
    insertEvent(dsl, me, cal, "회의 지난주", now.minusDays(7), null);
    insertEvent(dsl, me, cal, "회의 내일", now.plusDays(1), null);
    insertEvent(dsl, me, cal, "회의 다음주", now.plusDays(7), null);

    mvc.perform(get("/api/v1/calendar/events/search").param("q", "회의").with(as(me)))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.items", hasSize(3)))
        .andExpect(jsonPath("$.items[0].title").value("회의 내일"))
        .andExpect(jsonPath("$.items[0].past").value(false))
        .andExpect(jsonPath("$.items[0].matchedField").value("TITLE"))
        .andExpect(jsonPath("$.items[1].title").value("회의 다음주"))
        .andExpect(jsonPath("$.items[1].past").value(false))
        .andExpect(jsonPath("$.items[2].title").value("회의 지난주"))
        .andExpect(jsonPath("$.items[2].past").value(true))
        .andExpect(jsonPath("$.nextCursor").value(nullValue()))
        .andExpect(jsonPath("$.truncated").value(false));
  }

  @Test
  @DisplayName("후보_상한에_걸리면_truncated")
  void 후보_상한에_걸리면_truncated() throws Exception {
    // 상한(500)보다 한 건 많게 — 마지막 페이지(nextCursor=null)에서도 잘린 것을 알 수 있어야 한다
    for (int i = 0; i < 501; i++) {
      insertEvent(dsl, me, cal, "넘침 " + i, now.minusDays(1 + i), null);
    }
    mvc.perform(
            get("/api/v1/calendar/events/search")
                .param("q", "넘침")
                .param("cursor", "490")
                .with(as(me)))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.items", hasSize(10)))
        .andExpect(jsonPath("$.nextCursor").value(nullValue()))
        .andExpect(jsonPath("$.truncated").value(true));
  }

  @Test
  @DisplayName("다음_회차가_취소되면_그다음_회차")
  void 다음_회차가_취소되면_그다음_회차() throws Exception {
    // 매주 반복 — 다음 회차는 2일 뒤, 그다음은 9일 뒤. 2일 뒤 회차를 취소한다.
    OffsetDateTime start = now.minusWeeks(3).plusDays(2);
    long master = insertEvent(dsl, me, cal, "취소 반복", start, "FREQ=WEEKLY");
    insertException(dsl, master, start.plusWeeks(3), true, null);

    String body =
        mvc.perform(get("/api/v1/calendar/events/search").param("q", "취소 반복").with(as(me)))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.items", hasSize(1)))
            .andExpect(jsonPath("$.items[0].past").value(false))
            .andReturn()
            .getResponse()
            .getContentAsString();
    var item = new ObjectMapper().readTree(body).path("items").get(0);
    OffsetDateTime occ = OffsetDateTime.parse(item.path("occurrenceStart").asText());
    assertThat(occ.toInstant()).isEqualTo(start.plusWeeks(4).toInstant());
    // 전개기는 UTC 로 주지만 응답은 마스터 startsAt 의 오프셋으로 맞춘다
    OffsetDateTime startsAt = OffsetDateTime.parse(item.path("startsAt").asText());
    assertThat(occ.getOffset()).isEqualTo(startsAt.getOffset());
  }

  @Test
  @DisplayName("끝난_시리즈는_마지막_회차_기준으로_지난_묶음에서_정렬")
  void 끝난_시리즈는_마지막_회차_기준() throws Exception {
    // 10주 전 시작, 매주, UNTIL 8일 전 → 마지막 회차는 2주 전. 마스터 시작(10주 전) 기준이면 3주 전 단일보다 뒤로 밀린다.
    OffsetDateTime start = now.minusWeeks(10);
    String until =
        now.minusDays(8)
            .withOffsetSameInstant(ZoneOffset.UTC)
            .format(DateTimeFormatter.ofPattern("yyyyMMdd'T'HHmmss'Z'"));
    long series = insertEvent(dsl, me, cal, "끝남 시리즈", start, "FREQ=WEEKLY;UNTIL=" + until);
    long single = insertEvent(dsl, me, cal, "끝남 단일", now.minusWeeks(3), null);

    String body =
        mvc.perform(get("/api/v1/calendar/events/search").param("q", "끝남").with(as(me)))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.items", hasSize(2)))
            .andExpect(jsonPath("$.items[0].id").value(series))
            .andExpect(jsonPath("$.items[0].past").value(true))
            .andExpect(jsonPath("$.items[1].id").value(single))
            .andReturn()
            .getResponse()
            .getContentAsString();
    OffsetDateTime occ =
        OffsetDateTime.parse(
            new ObjectMapper()
                .readTree(body)
                .path("items")
                .get(0)
                .path("occurrenceStart")
                .asText());
    assertThat(occ.toInstant()).isEqualTo(now.minusWeeks(2).toInstant());
  }

  @Test
  @DisplayName("반복_일정은_한줄_다음회차")
  void 반복_일정은_한줄_다음회차() throws Exception {
    // 시작 3주 전, 매주 반복 — 다음 회차는 지금 이후 7일 안에 있다
    insertEvent(dsl, me, cal, "스탠드업", now.minusWeeks(3).minusDays(1), "FREQ=WEEKLY");
    // 끝난 반복(UNTIL 이 DTSTART 이후 1주 전) — 지난 일정, 정렬 키는 마스터 시작
    String until =
        now.minusWeeks(1)
            .withOffsetSameInstant(java.time.ZoneOffset.UTC)
            .format(java.time.format.DateTimeFormatter.ofPattern("yyyyMMdd'T'HHmmss'Z'"));
    insertEvent(dsl, me, cal, "스탠드업 종료", now.minusWeeks(5), "FREQ=WEEKLY;UNTIL=" + until);

    String body =
        mvc.perform(get("/api/v1/calendar/events/search").param("q", "스탠드업").with(as(me)))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.items", hasSize(2)))
            .andExpect(jsonPath("$.items[0].title").value("스탠드업"))
            .andExpect(jsonPath("$.items[0].past").value(false))
            .andExpect(jsonPath("$.items[1].title").value("스탠드업 종료"))
            .andExpect(jsonPath("$.items[1].past").value(true))
            .andReturn()
            .getResponse()
            .getContentAsString();

    // 다음 회차는 지금 이후 7일 안
    OffsetDateTime occ =
        OffsetDateTime.parse(
            new com.fasterxml.jackson.databind.ObjectMapper()
                .readTree(body)
                .path("items")
                .get(0)
                .path("occurrenceStart")
                .asText());
    org.assertj.core.api.Assertions.assertThat(occ)
        .isAfter(now)
        .isBefore(now.plusDays(7).plusMinutes(1));
  }

  @Test
  @DisplayName("진행_중인_반복_회차는_다가오는_일정")
  void 진행_중인_반복_회차는_다가오는_일정() throws Exception {
    // 매주 반복, 2주 전 시작 + 30분 전 → 이번 회차가 30분 전에 시작해 아직 진행 중(길이 1시간)
    insertEvent(dsl, me, cal, "진행중 반복", now.minusWeeks(2).minusMinutes(30), "FREQ=WEEKLY");

    String body =
        mvc.perform(get("/api/v1/calendar/events/search").param("q", "진행중").with(as(me)))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.items", hasSize(1)))
            .andExpect(jsonPath("$.items[0].past").value(false))
            .andReturn()
            .getResponse()
            .getContentAsString();
    // 진행 중인 회차는 이미 시작했으므로 occurrenceStart 는 지금보다 앞(약 30분 전)
    OffsetDateTime occ =
        OffsetDateTime.parse(
            new com.fasterxml.jackson.databind.ObjectMapper()
                .readTree(body)
                .path("items")
                .get(0)
                .path("occurrenceStart")
                .asText());
    org.assertj.core.api.Assertions.assertThat(occ).isBefore(now).isAfter(now.minusHours(1));
  }

  @Test
  @DisplayName("시작이_같으면_id_오름차순")
  void 시작이_같으면_id_오름차순() throws Exception {
    OffsetDateTime t = now.plusDays(1);
    long first = insertEvent(dsl, me, cal, "동시 A", t, null);
    long second = insertEvent(dsl, me, cal, "동시 B", t, null);

    mvc.perform(get("/api/v1/calendar/events/search").param("q", "동시").with(as(me)))
        .andExpect(jsonPath("$.items[0].id").value(first))
        .andExpect(jsonPath("$.items[1].id").value(second));
  }

  @Test
  @DisplayName("지난_일정끼리는_최근순")
  void 지난_일정끼리는_최근순() throws Exception {
    insertEvent(dsl, me, cal, "과거 오래전", now.minusDays(30), null);
    insertEvent(dsl, me, cal, "과거 어제", now.minusDays(1), null);
    insertEvent(dsl, me, cal, "과거 지난주", now.minusDays(7), null);

    mvc.perform(get("/api/v1/calendar/events/search").param("q", "과거").with(as(me)))
        .andExpect(jsonPath("$.items[0].title").value("과거 어제"))
        .andExpect(jsonPath("$.items[1].title").value("과거 지난주"))
        .andExpect(jsonPath("$.items[2].title").value("과거 오래전"));
  }

  @Test
  @DisplayName("딱_20건이면_다음커서_없음")
  void 딱_20건이면_다음커서_없음() throws Exception {
    for (int i = 0; i < 20; i++) {
      insertEvent(dsl, me, cal, "정확 " + i, now.plusDays(1 + i), null);
    }
    mvc.perform(get("/api/v1/calendar/events/search").param("q", "정확").with(as(me)))
        .andExpect(jsonPath("$.items", hasSize(20)))
        .andExpect(jsonPath("$.nextCursor").value(nullValue()));
  }

  @Test
  @DisplayName("잘못된_커서는_첫_페이지_너무_큰_커서는_빈_페이지")
  void 잘못된_커서() throws Exception {
    insertEvent(dsl, me, cal, "커서 하나", now.plusDays(1), null);
    for (String bad : new String[] {"abc", "-5"}) {
      mvc.perform(
              get("/api/v1/calendar/events/search")
                  .param("q", "커서")
                  .param("cursor", bad)
                  .with(as(me)))
          .andExpect(jsonPath("$.items", hasSize(1)));
    }
    mvc.perform(
            get("/api/v1/calendar/events/search")
                .param("q", "커서")
                .param("cursor", "99999999999")
                .with(as(me)))
        .andExpect(jsonPath("$.items", hasSize(0)))
        .andExpect(jsonPath("$.nextCursor").value(nullValue()));
  }

  @Test
  @DisplayName("동료_동기화_사본은_한줄")
  void 동료_동기화_사본은_한줄() throws Exception {
    long colleague = TestFixtures.createHuman(dsl);
    long colleagueCal = insertCalendar(dsl, colleague);
    long mine = insertEvent(dsl, me, cal, "공유 미팅", now.plusDays(1), null);
    long theirs = insertEvent(dsl, colleague, colleagueCal, "공유 미팅", now.plusDays(1), null);
    insertAttendee(dsl, theirs, me);
    dsl.update(CALENDAR_EVENT)
        .set(CALENDAR_EVENT.ICAL_UID, "UID-SEARCH-1")
        .where(CALENDAR_EVENT.ID.in(mine, theirs))
        .execute();

    mvc.perform(get("/api/v1/calendar/events/search").param("q", "공유").with(as(me)))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.items", hasSize(1)))
        .andExpect(jsonPath("$.items[0].id").value(mine));
  }

  @Test
  @DisplayName("페이지_20건_다음커서")
  void 페이지_20건_다음커서() throws Exception {
    for (int i = 0; i < 25; i++) {
      insertEvent(dsl, me, cal, "페이지 " + i, now.plusDays(1 + i), null);
    }
    mvc.perform(get("/api/v1/calendar/events/search").param("q", "페이지").with(as(me)))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.items", hasSize(20)))
        .andExpect(jsonPath("$.nextCursor").value("20"));
    mvc.perform(
            get("/api/v1/calendar/events/search")
                .param("q", "페이지")
                .param("cursor", "20")
                .with(as(me)))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.items", hasSize(5)))
        .andExpect(jsonPath("$.nextCursor").value(nullValue()));
  }

  @Test
  @DisplayName("limit_은_50으로_자른다")
  void limit_은_50으로_자른다() throws Exception {
    for (int i = 0; i < 55; i++) {
      insertEvent(dsl, me, cal, "대량 " + i, now.plusDays(1 + i), null);
    }
    mvc.perform(
            get("/api/v1/calendar/events/search")
                .param("q", "대량")
                .param("limit", "999")
                .with(as(me)))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.items", hasSize(50)))
        .andExpect(jsonPath("$.nextCursor").value("50"));
  }

  @Test
  @DisplayName("빈_검색어는_빈목록")
  void 빈_검색어는_빈목록() throws Exception {
    insertEvent(dsl, me, cal, "무언가", now.plusDays(1), null);
    for (String q : new String[] {"", "   "}) {
      mvc.perform(get("/api/v1/calendar/events/search").param("q", q).with(as(me)))
          .andExpect(status().isOk())
          .andExpect(jsonPath("$.items", hasSize(0)))
          .andExpect(jsonPath("$.nextCursor").value(nullValue()));
    }
    // q 파라미터 자체가 없어도 400 이 아니라 빈 목록
    mvc.perform(get("/api/v1/calendar/events/search").with(as(me)))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.items", hasSize(0)));
  }

  @Test
  @DisplayName("인증없으면_401")
  void 인증없으면_401() throws Exception {
    mvc.perform(get("/api/v1/calendar/events/search").param("q", "회의"))
        .andExpect(status().isUnauthorized());
  }
}
