package com.workplace.calendar;

import static com.workplace.jooq.Tables.CALENDAR;
import static com.workplace.jooq.Tables.CALENDAR_USER_SETTING;
import static com.workplace.jooq.Tables.EMAIL_ACCOUNT;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.authentication;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workplace.calendar.repository.CalendarRepository;
import com.workplace.calendar.service.CalendarService;
import com.workplace.global.tenant.TenantContext;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.time.OffsetDateTime;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.RequestPostProcessor;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/**
 * 새 일정 기본 캘린더 설정 GET/PUT(WP-2169) 통합 — 처음 조회 Works 캘린더, 로컬·외부 캘린더 지정과 Works 로 되돌리기, 남의/읽기 전용/연결 해제
 * 캘린더 거절, 지정 캘린더 삭제(SET NULL)·연결 해제 시 Works 로 폴백, 캘린더를 생략한 일정 생성이 지정 캘린더를 따르는지, 테넌트 분리.
 *
 * <p>@Transactional 이라 MockMvc 요청이 테스트 트랜잭션에 합류해 시드를 보고, 끝나면 롤백된다. 그래서 이 안의 POST 생성은 「호출자 트랜잭션 안」으로
 * 판정된다 — 외부 캘린더 생성(Graph)은 여기서 검증하지 않고, 생성 검증은 두 번째 로컬 캘린더로 한다.
 */
@Transactional
class CalendarUserSettingIntegrationTest extends IntegrationTestBase {

  @Autowired MockMvc mvc;
  @Autowired DSLContext dsl;
  @Autowired ObjectMapper om;
  @Autowired CalendarService calendarService;
  @Autowired CalendarRepository calendarRepo;

  /** 테넌트#1 멤버 사용자. */
  long user() {
    TenantContext.set(1L);
    return withMembership(TestFixtures.createHuman(dsl));
  }

  /** 캘린더 읽기·쓰기 권한을 가진 사람 요청으로 꾸민다(요청마다 그 테넌트로 되돌린다). */
  RequestPostProcessor as(long uid, long tenantId) {
    RequestPostProcessor auth =
        authentication(
            new UsernamePasswordAuthenticationToken(
                uid,
                "n/a",
                List.of(
                    new SimpleGrantedAuthority("calendar:read"),
                    new SimpleGrantedAuthority("calendar:write"))));
    return req -> {
      TenantContext.set(tenantId);
      return auth.postProcessRequest(req);
    };
  }

  ResultActions getSetting(long uid, long tenantId) throws Exception {
    return mvc.perform(get("/api/v1/calendar/settings").with(as(uid, tenantId)));
  }

  ResultActions getSetting(long uid) throws Exception {
    return getSetting(uid, 1L);
  }

  ResultActions putSetting(long uid, long tenantId, Map<String, Object> body) throws Exception {
    return mvc.perform(
        put("/api/v1/calendar/settings")
            .with(as(uid, tenantId))
            .contentType(MediaType.APPLICATION_JSON)
            .content(om.writeValueAsString(body)));
  }

  ResultActions putSetting(long uid, Map<String, Object> body) throws Exception {
    return putSetting(uid, 1L, body);
  }

  /** 요청 본문 — null 값도 그대로 싣는다(Map.of 는 null 을 받지 않는다). */
  static Map<String, Object> body(Object calendarId) {
    Map<String, Object> b = new HashMap<>();
    b.put("calendarId", calendarId);
    return b;
  }

  /** GET 응답의 실효 기본 캘린더 id. */
  long effectiveDefault(long uid) throws Exception {
    String json =
        getSetting(uid).andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
    JsonNode node = om.readTree(json);
    return node.get("defaultCalendarId").asLong();
  }

  /** 캘린더를 생략한 일정 생성 — 만들어진 일정의 캘린더 id 를 돌려준다. */
  long createWithoutCalendar(long uid) throws Exception {
    Map<String, Object> req = new HashMap<>();
    req.put("title", "캘린더 생략 일정");
    req.put("startsAt", "2026-12-01T10:00:00+09:00");
    req.put("endsAt", "2026-12-01T11:00:00+09:00");
    req.put("allDay", false);
    String json =
        mvc.perform(
                post("/api/v1/calendar/events")
                    .with(as(uid, 1L))
                    .contentType(MediaType.APPLICATION_JSON)
                    .content(om.writeValueAsString(req)))
            .andExpect(status().isCreated())
            .andReturn()
            .getResponse()
            .getContentAsString();
    return om.readTree(json).get("calendarId").asLong();
  }

  /** M365 메일 계정 — disabledAt 이 있으면 연결 해제(soft-delete)된 계정. */
  long insertAccount(long userId, OffsetDateTime disabledAt) {
    return dsl.insertInto(EMAIL_ACCOUNT)
        .set(EMAIL_ACCOUNT.USER_ID, userId)
        .set(EMAIL_ACCOUNT.EMAIL_ADDRESS, "acc-" + System.nanoTime() + "@example.com")
        .set(EMAIL_ACCOUNT.DISPLAY_NAME, "acc")
        .set(EMAIL_ACCOUNT.PROVIDER, "M365_GRAPH")
        .set(EMAIL_ACCOUNT.DISABLED_AT, disabledAt)
        .returning(EMAIL_ACCOUNT.ID)
        .fetchOne()
        .getId();
  }

  /** 캘린더 시드 — externalAccountId 가 있으면 외부(Outlook) 캘린더. */
  long insertCalendar(long ownerId, Long externalAccountId, boolean readOnly) {
    return dsl.insertInto(CALENDAR)
        .set(CALENDAR.OWNER_ID, ownerId)
        .set(CALENDAR.NAME, externalAccountId == null ? "두 번째" : "Outlook")
        .set(CALENDAR.COLOR, "blue")
        .set(CALENDAR.IS_DEFAULT, false)
        .set(CALENDAR.POSITION, 1)
        .set(CALENDAR.EXTERNAL_ACCOUNT_ID, externalAccountId)
        .set(CALENDAR.EXTERNAL_ID, externalAccountId == null ? null : "ext-" + System.nanoTime())
        .set(CALENDAR.IS_READ_ONLY, readOnly)
        .returning(CALENDAR.ID)
        .fetchOne()
        .getId();
  }

  @Test
  void 처음_조회하면_Works_캘린더() throws Exception {
    long me = user();

    long def = effectiveDefault(me);

    assertThat(def).isEqualTo(calendarRepo.findDefaultId(me).orElseThrow());
  }

  @Test
  void 두번째_로컬_캘린더를_지정하면_GET_과_캘린더_생략_생성이_그것을_따른다() throws Exception {
    long me = user();
    long second = insertCalendar(me, null, false);

    putSetting(me, body(second))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.defaultCalendarId").value(second));

    assertThat(effectiveDefault(me)).isEqualTo(second);
    assertThat(createWithoutCalendar(me)).isEqualTo(second);
  }

  @Test
  void Works_캘린더를_다시_지정하면_Works_로_돌아온다() throws Exception {
    long me = user();
    long works = calendarService.ensureDefault(me);
    long second = insertCalendar(me, null, false);
    putSetting(me, body(second)).andExpect(status().isOk());

    putSetting(me, body(works))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.defaultCalendarId").value(works));

    assertThat(effectiveDefault(me)).isEqualTo(works);
    // 한 사람에 한 행만 남고, Works 를 지정하면 preferred 는 Works id 로 저장된다.
    assertThat(
            dsl.select(CALENDAR_USER_SETTING.PREFERRED_CALENDAR_ID)
                .from(CALENDAR_USER_SETTING)
                .where(CALENDAR_USER_SETTING.USER_ID.eq(me))
                .fetch(CALENDAR_USER_SETTING.PREFERRED_CALENDAR_ID))
        .containsExactly(works);
  }

  @Test
  void 남의_없는_연결해제_캘린더는_404_읽기_전용은_409_빈_값은_400() throws Exception {
    long me = user();
    long other = user();
    long othersCal = insertCalendar(other, null, false);
    long readOnlyExt = insertCalendar(me, insertAccount(me, null), true);
    long disabledExt = insertCalendar(me, insertAccount(me, OffsetDateTime.now()), false);
    // 연결 해제 계정의 읽기 전용 캘린더 — 목록에서 숨겨지므로 읽기 전용 409 보다 404 가 먼저다.
    long disabledReadOnlyExt = insertCalendar(me, insertAccount(me, OffsetDateTime.now()), true);

    putSetting(me, body(othersCal)).andExpect(status().isNotFound());
    putSetting(me, body(Long.MAX_VALUE)).andExpect(status().isNotFound());
    putSetting(me, body(disabledExt)).andExpect(status().isNotFound());
    putSetting(me, body(disabledReadOnlyExt)).andExpect(status().isNotFound());
    putSetting(me, body(readOnlyExt)).andExpect(status().isConflict());
    putSetting(me, body(null)).andExpect(status().isBadRequest());

    // 거절된 요청은 아무것도 남기지 않는다.
    assertThat(dsl.fetchCount(CALENDAR_USER_SETTING, CALENDAR_USER_SETTING.USER_ID.eq(me)))
        .isZero();
    assertThat(effectiveDefault(me)).isEqualTo(calendarRepo.findDefaultId(me).orElseThrow());
  }

  @Test
  void 지정한_캘린더를_지우면_GET_과_생략_생성은_Works() throws Exception {
    long me = user();
    long works = calendarService.ensureDefault(me);
    long second = insertCalendar(me, null, false);
    putSetting(me, body(second)).andExpect(status().isOk());

    mvc.perform(delete("/api/v1/calendars/" + second).with(as(me, 1L)))
        .andExpect(status().is2xxSuccessful());

    // FK ON DELETE SET NULL — 행은 남고 preferred 만 비어 오류 없이 Works 로 돌아간다.
    assertThat(effectiveDefault(me)).isEqualTo(works);
    assertThat(createWithoutCalendar(me)).isEqualTo(works);
  }

  @Test
  void 지정한_Outlook_캘린더의_계정을_연결_해제하면_Works() throws Exception {
    long me = user();
    long works = calendarService.ensureDefault(me);
    long account = insertAccount(me, null);
    long outlook = insertCalendar(me, account, false);
    putSetting(me, body(outlook)).andExpect(status().isOk());
    assertThat(effectiveDefault(me)).isEqualTo(outlook);

    dsl.update(EMAIL_ACCOUNT)
        .set(EMAIL_ACCOUNT.DISABLED_AT, OffsetDateTime.now())
        .where(EMAIL_ACCOUNT.ID.eq(account))
        .execute();

    assertThat(effectiveDefault(me)).isEqualTo(works);
    // 트랜잭션 밖 생성(외부 허용)도 연결 해제 캘린더를 고르지 않는다.
    assertThat(calendarService.resolveCreateCalendarId(me, true, true)).isEqualTo(works);
    // 캘린더 생략 생성의 트랜잭션 분기(밖=외부 기본, 안=Works)는 이 @Transactional 클래스에서 증명할 수 없어
    // CalendarEventWriteThroughTest 의 create_without_calendar_* 가 검증한다.
  }

  @Test
  void Outlook_쓰기가능_캘린더를_지정하면_GET_은_그것_외부_불허_해석은_Works() throws Exception {
    long me = user();
    long works = calendarService.ensureDefault(me);
    long outlook = insertCalendar(me, insertAccount(me, null), false);

    putSetting(me, body(outlook))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.defaultCalendarId").value(outlook));

    assertThat(effectiveDefault(me)).isEqualTo(outlook);
    assertThat(calendarService.resolveCreateCalendarId(me, true, false)).isEqualTo(outlook);
    // 확인 카드 경로(외부 불허)는 Works 로 정한다.
    assertThat(calendarService.resolveCreateCalendarId(me, false, false)).isEqualTo(works);
    assertThat(calendarService.isUsableCreateTarget(me, outlook, true)).isTrue();
    assertThat(calendarService.isUsableCreateTarget(me, outlook, false)).isFalse();
  }

  @Test
  void 지정한_캘린더가_나중에_읽기_전용이_되면_GET_과_해석은_Works() throws Exception {
    long me = user();
    long works = calendarService.ensureDefault(me);
    long second = insertCalendar(me, null, false);
    putSetting(me, body(second)).andExpect(status().isOk());
    assertThat(effectiveDefault(me)).isEqualTo(second);

    // 지정 뒤에 읽기 전용으로 바뀐 경우 — 설정 행은 남아 있어도 쓸 수 없으니 Works 로 돌아가야 한다.
    dsl.update(CALENDAR).set(CALENDAR.IS_READ_ONLY, true).where(CALENDAR.ID.eq(second)).execute();

    assertThat(effectiveDefault(me)).isEqualTo(works);
    assertThat(calendarService.resolveCreateCalendarId(me, true, true)).isEqualTo(works);
  }

  @Test
  void 다른_테넌트에서는_이_설정이_보이지_않는다() throws Exception {
    // 같은 사람이 두 워크스페이스(테넌트)에 속한다 — 설정은 테넌트마다 따로다.
    long me = user();
    long second = insertCalendar(me, null, false);
    putSetting(me, body(second)).andExpect(status().isOk());

    long other = ensureFixtureTenant("wp2169-other");
    TestFixtures.ensureActiveMember(dsl, me, other);
    useTenant(other);
    assertThat(dsl.fetchCount(CALENDAR_USER_SETTING, CALENDAR_USER_SETTING.USER_ID.eq(me)))
        .isZero();
    String json =
        getSetting(me, other)
            .andExpect(status().isOk())
            .andReturn()
            .getResponse()
            .getContentAsString();
    assertThat(om.readTree(json).get("defaultCalendarId").asLong()).isNotEqualTo(second);

    useTenant(1L);
    assertThat(effectiveDefault(me)).isEqualTo(second);
  }
}
