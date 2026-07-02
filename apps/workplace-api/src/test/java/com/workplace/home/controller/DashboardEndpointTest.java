package com.workplace.home.controller;

import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static com.workplace.jooq.tables.UserDashboard.USER_DASHBOARD;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.global.security.JwtTokenProvider;
import com.workplace.home.dto.DashboardUpdateRequest;
import com.workplace.home.dto.DashboardWidgetConfig;
import com.workplace.support.IntegrationTestBase;
import java.util.List;
import java.util.UUID;
import org.jooq.DSLContext;
import org.jooq.JSONB;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;

/**
 * GET/PUT /api/v1/me/dashboard 통합 테스트. 실 JWT 발급 + MockMvc 로 전체 보안 체인을 통과시켜 기본 레이아웃·객체 배열 라운드트립·검증
 * 거부(400)·레거시(문자열 배열) 읽기 호환을 검증한다. 테스트 프로파일은 connection-init 으로 app.tenant_id=1 이 주입되므로 tenant RLS
 * 하에서도 본인 행을 읽고 쓸 수 있다(별도 멤버십 시드 불필요).
 */
@AutoConfigureMockMvc
@Transactional
class DashboardEndpointTest extends IntegrationTestBase {

  @Autowired MockMvc mvc;
  @Autowired ObjectMapper om;
  @Autowired DSLContext dsl;
  @Autowired JwtTokenProvider jwtTokenProvider;

  /** USER 역할이 부여된 사용자 시드. */
  private long createUser(String prefix) {
    String suffix = UUID.randomUUID().toString().substring(0, 8);
    Long id =
        dsl.insertInto(USER)
            .set(USER.USERNAME, prefix + "-" + suffix)
            .set(USER.PASSWORD, "pw")
            .set(USER.NAME, prefix)
            .set(USER.EMAIL, prefix + "-" + suffix + "@example.com")
            .returning(USER.ID)
            .fetchOne()
            .getId();
    Long roleId = dsl.select(ROLE.ID).from(ROLE).where(ROLE.NAME.eq("USER")).fetchOne(ROLE.ID);
    dsl.insertInto(USER_ROLE).set(USER_ROLE.USER_ID, id).set(USER_ROLE.ROLE_ID, roleId).execute();
    return id;
  }

  /** userId 용 access token 발급 (Bearer 헤더 본문). */
  private String tokenFor(long userId) {
    return jwtTokenProvider.generateAccessToken(userId, "user-" + userId);
  }

  @Test
  void get_returns_default_when_unset() throws Exception {
    // #브레인스토밍 2026-07-02: synthesis/quick_actions/priority_quadrant 를 기본 레이아웃 맨 앞에
    // 추가(DashboardService.DEFAULT_WIDGETS 8개) — 그리드 통합 아키텍처 전환.
    long userId = createUser("d");
    mvc.perform(get("/api/v1/me/dashboard").header("Authorization", "Bearer " + tokenFor(userId)))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.widgets.length()").value(8))
        .andExpect(jsonPath("$.widgets[0].type").value("synthesis"))
        .andExpect(jsonPath("$.widgets[1].type").value("quick_actions"))
        .andExpect(jsonPath("$.widgets[2].type").value("priority_quadrant"))
        .andExpect(jsonPath("$.widgets[3].type").value("my_tasks"))
        .andExpect(jsonPath("$.widgets[3].count").value(5))
        .andExpect(jsonPath("$.widgets[3].hidden").value(false));
  }

  @Test
  void put_then_get_roundtrips() throws Exception {
    long userId = createUser("e");
    // 숨김 위젯 + count=10 위젯 포함한 객체 배열 라운드트립.
    String body =
        om.writeValueAsString(
            new DashboardUpdateRequest(
                List.of(
                    new DashboardWidgetConfig("calendar_today", 10, false),
                    new DashboardWidgetConfig("my_tasks", 5, true))));

    mvc.perform(
            put("/api/v1/me/dashboard")
                .header("Authorization", "Bearer " + tokenFor(userId))
                .contentType(MediaType.APPLICATION_JSON)
                .content(body))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.widgets[0].type").value("calendar_today"))
        .andExpect(jsonPath("$.widgets[0].count").value(10));

    mvc.perform(get("/api/v1/me/dashboard").header("Authorization", "Bearer " + tokenFor(userId)))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.widgets.length()").value(2))
        .andExpect(jsonPath("$.widgets[0].type").value("calendar_today"))
        .andExpect(jsonPath("$.widgets[0].count").value(10))
        .andExpect(jsonPath("$.widgets[0].hidden").value(false))
        .andExpect(jsonPath("$.widgets[1].type").value("my_tasks"))
        .andExpect(jsonPath("$.widgets[1].count").value(5))
        .andExpect(jsonPath("$.widgets[1].hidden").value(true));
  }

  @Test
  void put_rejects_unknown_type() throws Exception {
    long userId = createUser("f");
    String body =
        om.writeValueAsString(
            new DashboardUpdateRequest(
                List.of(new DashboardWidgetConfig("bogus_widget", 5, false))));

    mvc.perform(
            put("/api/v1/me/dashboard")
                .header("Authorization", "Bearer " + tokenFor(userId))
                .contentType(MediaType.APPLICATION_JSON)
                .content(body))
        .andExpect(status().isBadRequest());
  }

  @Test
  void put_rejects_invalid_count() throws Exception {
    long userId = createUser("g");
    String body =
        om.writeValueAsString(
            new DashboardUpdateRequest(List.of(new DashboardWidgetConfig("my_tasks", 7, false))));

    mvc.perform(
            put("/api/v1/me/dashboard")
                .header("Authorization", "Bearer " + tokenFor(userId))
                .contentType(MediaType.APPLICATION_JSON)
                .content(body))
        .andExpect(status().isBadRequest());
  }

  @Test
  void put_rejects_duplicate_type() throws Exception {
    long userId = createUser("h");
    String body =
        om.writeValueAsString(
            new DashboardUpdateRequest(
                List.of(
                    new DashboardWidgetConfig("my_tasks", 5, false),
                    new DashboardWidgetConfig("my_tasks", 10, false))));

    mvc.perform(
            put("/api/v1/me/dashboard")
                .header("Authorization", "Bearer " + tokenFor(userId))
                .contentType(MediaType.APPLICATION_JSON)
                .content(body))
        .andExpect(status().isBadRequest());
  }

  @Test
  void put_rejects_empty_list() throws Exception {
    long userId = createUser("j");
    String body = om.writeValueAsString(new DashboardUpdateRequest(List.of()));

    mvc.perform(
            put("/api/v1/me/dashboard")
                .header("Authorization", "Bearer " + tokenFor(userId))
                .contentType(MediaType.APPLICATION_JSON)
                .content(body))
        .andExpect(status().isBadRequest());
  }

  @Test
  void put_coerces_zero_count_to_default() throws Exception {
    long userId = createUser("k");
    // count=0(미지정 의미)은 수용되고 기본값 5로 보정되어야 한다(designed behavior).
    String body =
        om.writeValueAsString(
            new DashboardUpdateRequest(List.of(new DashboardWidgetConfig("my_tasks", 0, false))));

    mvc.perform(
            put("/api/v1/me/dashboard")
                .header("Authorization", "Bearer " + tokenFor(userId))
                .contentType(MediaType.APPLICATION_JSON)
                .content(body))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.widgets[0].count").value(5));

    mvc.perform(get("/api/v1/me/dashboard").header("Authorization", "Bearer " + tokenFor(userId)))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.widgets[0].type").value("my_tasks"))
        .andExpect(jsonPath("$.widgets[0].count").value(5));
  }

  @Test
  void get_converts_legacy_string_array() throws Exception {
    long userId = createUser("i");
    // 레거시 형태(문자열 배열)를 직접 시드 → GET 이 기본 설정 객체로 변환해야 한다.
    dsl.insertInto(USER_DASHBOARD)
        .set(USER_DASHBOARD.USER_ID, userId)
        .set(USER_DASHBOARD.WIDGETS, JSONB.valueOf("[\"calendar_today\",\"my_tasks\"]"))
        .execute();

    mvc.perform(get("/api/v1/me/dashboard").header("Authorization", "Bearer " + tokenFor(userId)))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.widgets.length()").value(2))
        .andExpect(jsonPath("$.widgets[0].type").value("calendar_today"))
        .andExpect(jsonPath("$.widgets[0].count").value(5))
        .andExpect(jsonPath("$.widgets[0].hidden").value(false))
        .andExpect(jsonPath("$.widgets[1].type").value("my_tasks"));
  }

  @Test
  void put_then_get_roundtrips_catalog_widget_multiple_instances() throws Exception {
    long userId = createUser("l");
    // 같은 카탈로그 타입(issue_list)을 필터가 다른 두 인스턴스로 추가.
    String body =
        om.writeValueAsString(
            new DashboardUpdateRequest(
                List.of(
                    new DashboardWidgetConfig(
                        "sec-1",
                        "issue_list",
                        0,
                        false,
                        om.readTree("{\"assignee\":\"all\"}"),
                        "보안팀 이슈"),
                    new DashboardWidgetConfig(
                        "mkt-1",
                        "issue_list",
                        0,
                        false,
                        om.readTree("{\"assignee\":\"me\"}"),
                        "마케팅팀 이슈"),
                    new DashboardWidgetConfig("my_tasks", 5, false))));

    mvc.perform(
            put("/api/v1/me/dashboard")
                .header("Authorization", "Bearer " + tokenFor(userId))
                .contentType(MediaType.APPLICATION_JSON)
                .content(body))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.widgets.length()").value(3))
        .andExpect(jsonPath("$.widgets[0].id").value("sec-1"))
        .andExpect(jsonPath("$.widgets[0].label").value("보안팀 이슈"))
        .andExpect(jsonPath("$.widgets[0].params.assignee").value("all"))
        .andExpect(jsonPath("$.widgets[1].id").value("mkt-1"))
        .andExpect(jsonPath("$.widgets[1].params.assignee").value("me"))
        .andExpect(jsonPath("$.widgets[2].id").value("my_tasks"));

    mvc.perform(get("/api/v1/me/dashboard").header("Authorization", "Bearer " + tokenFor(userId)))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.widgets.length()").value(3))
        .andExpect(jsonPath("$.widgets[0].type").value("issue_list"))
        .andExpect(jsonPath("$.widgets[1].type").value("issue_list"))
        .andExpect(jsonPath("$.widgets[1].label").value("마케팅팀 이슈"));
  }

  @Test
  void put_generates_id_when_catalog_widget_id_missing() throws Exception {
    long userId = createUser("m");
    // id 미지정 카탈로그 위젯 — 서버가 UUID 를 생성해야 한다.
    String body =
        om.writeValueAsString(
            new DashboardUpdateRequest(
                List.of(new DashboardWidgetConfig(null, "mail_list", 0, false, null, null))));

    mvc.perform(
            put("/api/v1/me/dashboard")
                .header("Authorization", "Bearer " + tokenFor(userId))
                .contentType(MediaType.APPLICATION_JSON)
                .content(body))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.widgets[0].id").isNotEmpty())
        .andExpect(jsonPath("$.widgets[0].type").value("mail_list"));
  }

  @Test
  void put_rejects_over_max_widgets() throws Exception {
    long userId = createUser("n");
    List<DashboardWidgetConfig> widgets = new java.util.ArrayList<>();
    for (int i = 0; i < 13; i++) {
      widgets.add(new DashboardWidgetConfig("chan-" + i, "channels", 0, false, null, null));
    }
    String body = om.writeValueAsString(new DashboardUpdateRequest(widgets));

    mvc.perform(
            put("/api/v1/me/dashboard")
                .header("Authorization", "Bearer " + tokenFor(userId))
                .contentType(MediaType.APPLICATION_JSON)
                .content(body))
        .andExpect(status().isBadRequest());
  }

  @Test
  void put_rejects_non_object_params() throws Exception {
    long userId = createUser("o");
    String body =
        om.writeValueAsString(
            new DashboardUpdateRequest(
                List.of(
                    new DashboardWidgetConfig(
                        "act-1", "activity", 0, false, om.readTree("[1,2,3]"), null))));

    mvc.perform(
            put("/api/v1/me/dashboard")
                .header("Authorization", "Bearer " + tokenFor(userId))
                .contentType(MediaType.APPLICATION_JSON)
                .content(body))
        .andExpect(status().isBadRequest());
  }

  @Test
  void put_allows_duplicate_catalog_type_but_rejects_duplicate_id() throws Exception {
    long userId = createUser("p");
    String body =
        om.writeValueAsString(
            new DashboardUpdateRequest(
                List.of(
                    new DashboardWidgetConfig("dup-1", "wiki", 0, false, null, null),
                    new DashboardWidgetConfig("dup-1", "wiki", 0, false, null, null))));

    mvc.perform(
            put("/api/v1/me/dashboard")
                .header("Authorization", "Bearer " + tokenFor(userId))
                .contentType(MediaType.APPLICATION_JSON)
                .content(body))
        .andExpect(status().isBadRequest());
  }
}
