package com.workplace.wiki.report;

import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workplace.auth.service.AssistantResolver;
import com.workplace.auth.service.AssistantSpec;
import com.workplace.global.security.JwtTokenProvider;
import com.workplace.global.tenant.TenantContext;
import com.workplace.issue.report.PersonalReportPeriod;
import com.workplace.support.ExternalClientMockedTestBase;
import com.workplace.support.TestFixtures;
import com.workplace.wiki.report.PersonalReportRepository.Reservation;
import com.workplace.wiki.service.WikiSystemPageWriter;
import com.workplace.wiki.service.WikiSystemPageWriter.PersonalReportsHome;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.util.Optional;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.transaction.annotation.Transactional;

/**
 * 개인 보고 REST(WP-1486) — 대상은 언제나 로그인한 본인. 설정 GET/PUT, 만들기 202·같은 회차 409 본문(code·pageId), 남의 회차 404,
 * 찾기 없음 204, 로그인 필요 401 을 HTTP 로 확인한다.
 *
 * <p>@Transactional: MockMvc 요청이 테스트 트랜잭션에 합류해 시드를 보고 끝나면 롤백된다(커밋되지 않으므로 생성 실행기는 돌지 않는다).
 */
@Transactional
class PersonalReportControllerTest extends ExternalClientMockedTestBase {

  /** 어제(서울) — 미래 거절에 걸리지 않는 날. */
  private static final LocalDate DAY = LocalDate.now(ZoneId.of("Asia/Seoul")).minusDays(1);

  @Autowired MockMvc mvc;
  @Autowired DSLContext dsl;
  @Autowired JwtTokenProvider jwt;
  @Autowired WikiSystemPageWriter writer;
  @Autowired PersonalReportRepository reports;
  @Autowired AssistantResolver assistantResolver;

  private long me;
  private long other;

  @BeforeEach
  void seed() {
    TenantContext.set(1L);
    me = human();
    other = human();
    when(assistantResolver.resolveOrEmpty(anyLong()))
        .thenReturn(Optional.of(new AssistantSpec(1L, "m", "low", 4, 60_000)));
  }

  @Test
  void getSettings_200() throws Exception {
    call(get("/api/v1/me/report-settings"), me)
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.dailyEnabled").value(false))
        .andExpect(jsonPath("$.timeOfDay").value("09:00"))
        .andExpect(jsonPath("$.skipEmpty").value(true))
        .andExpect(jsonPath("$.assistantAvailable").value(true));
  }

  @Test
  void putSettings_200() throws Exception {
    call(
            put("/api/v1/me/report-settings")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"dailyEnabled\":true,\"timeOfDay\":\"08:00\",\"skipEmpty\":false}"),
            me)
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.dailyEnabled").value(true))
        .andExpect(jsonPath("$.timeOfDay").value("08:00"))
        .andExpect(jsonPath("$.skipEmpty").value(false))
        .andExpect(jsonPath("$.dailyTemplatePageId").isNumber())
        .andExpect(jsonPath("$.weeklyTemplatePageId").isNumber())
        .andExpect(jsonPath("$.reportsPageId").isNumber())
        .andExpect(jsonPath("$.nextRunAt").isNotEmpty());
    // 남의 설정에는 영향이 없다.
    call(get("/api/v1/me/report-settings"), other)
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.dailyEnabled").value(false));
  }

  @Test
  void putSettings_invalidTime_400() throws Exception {
    call(
            put("/api/v1/me/report-settings")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"dailyEnabled\":true,\"timeOfDay\":\"09:30\"}"),
            me)
        .andExpect(status().isBadRequest());
  }

  @Test
  void resetTemplate_monthly_400() throws Exception {
    call(post("/api/v1/me/report-settings/templates/MONTHLY/reset"), me)
        .andExpect(status().isBadRequest());
  }

  @Test
  void postReport_202() throws Exception {
    call(
            post("/api/v1/me/reports")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"kind\":\"DAILY\",\"date\":\"" + DAY + "\"}"),
            me)
        .andExpect(status().isAccepted())
        .andExpect(jsonPath("$.id").isNumber())
        .andExpect(jsonPath("$.status").value("PENDING"));
  }

  @Test
  void postReport_exists_409Body() throws Exception {
    long pageId = generated(me, DAY);

    call(
            post("/api/v1/me/reports")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"kind\":\"DAILY\",\"date\":\"" + DAY + "\",\"force\":false}"),
            me)
        .andExpect(status().isConflict())
        .andExpect(jsonPath("$.code").value("REPORT_EXISTS"))
        .andExpect(jsonPath("$.pageId").value(pageId))
        .andExpect(jsonPath("$.title").value("기존 보고"));
  }

  @Test
  void postReport_future_400() throws Exception {
    call(
            post("/api/v1/me/reports")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"kind\":\"DAILY\",\"date\":\"" + DAY.plusDays(3) + "\"}"),
            me)
        .andExpect(status().isBadRequest());
  }

  @Test
  void getReport_otherUsersId_404() throws Exception {
    Reservation r = reports.reserve(me, PersonalReportPeriod.daily(DAY), "MANUAL", now());

    call(get("/api/v1/me/reports/" + r.id()), other).andExpect(status().isNotFound());
    call(get("/api/v1/me/reports/" + r.id()), me)
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.id").value(r.id()))
        .andExpect(jsonPath("$.status").value("PENDING"));
  }

  @Test
  void lookup_none_204() throws Exception {
    call(get("/api/v1/me/reports").param("kind", "DAILY").param("date", DAY.toString()), me)
        .andExpect(status().isNoContent());
    long pageId = generated(me, DAY);
    call(get("/api/v1/me/reports").param("kind", "DAILY").param("date", DAY.toString()), me)
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.pageId").value(pageId))
        .andExpect(jsonPath("$.title").value("기존 보고"));
    // 남의 보고는 보이지 않는다.
    call(get("/api/v1/me/reports").param("kind", "DAILY").param("date", DAY.toString()), other)
        .andExpect(status().isNoContent());
  }

  @Test
  void unauthenticated_401() throws Exception {
    mvc.perform(get("/api/v1/me/report-settings")).andExpect(status().isUnauthorized());
    mvc.perform(
            post("/api/v1/me/reports")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"kind\":\"DAILY\",\"date\":\"" + DAY + "\"}"))
        .andExpect(status().isUnauthorized());
  }

  /** 그 날 일일 회차를 페이지(제목 「기존 보고」)까지 만든 상태로 둔다. */
  private long generated(long userId, LocalDate day) {
    PersonalReportsHome home = writer.ensurePersonalReportsHome(userId);
    long pageId = writer.createPage(userId, home.spaceId(), home.reportsPageId(), "기존 보고").id();
    Reservation r = reports.reserve(userId, PersonalReportPeriod.daily(day), "MANUAL", now());
    reports.markGenerated(r.id(), pageId, 1, 0, 0, now());
    return pageId;
  }

  private static OffsetDateTime now() {
    return OffsetDateTime.now();
  }

  private ResultActions call(MockHttpServletRequestBuilder req, long userId) throws Exception {
    req.header("Authorization", "Bearer " + jwt.generateAccessToken(userId, "u-" + userId, 1L));
    return mvc.perform(req);
  }

  private long human() {
    long id = withMembership(TestFixtures.createHuman(dsl));
    grantUserRole(id);
    return id;
  }
}
