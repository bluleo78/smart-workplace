package com.workplace.home.controller;

import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.global.security.JwtTokenProvider;
import com.workplace.home.dto.DashboardUpdateRequest;
import com.workplace.support.IntegrationTestBase;
import java.util.List;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;

/**
 * GET/PUT /api/v1/me/dashboard 통합 테스트. 실 JWT 발급 + MockMvc 로 전체 보안 체인을 통과시켜 기본 레이아웃·라운드트립·미지 위젯
 * 거부(400)를 검증한다. 테스트 프로파일은 connection-init 으로 app.tenant_id=1 이 주입되므로 tenant RLS 하에서도 본인 행을 읽고 쓸 수
 * 있다(별도 멤버십 시드 불필요).
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
    long userId = createUser("d");
    mvc.perform(get("/api/v1/me/dashboard").header("Authorization", "Bearer " + tokenFor(userId)))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.widgets[0]").value("my_tasks"))
        .andExpect(jsonPath("$.widgets.length()").value(5));
  }

  @Test
  void put_then_get_roundtrips() throws Exception {
    long userId = createUser("e");
    String body =
        om.writeValueAsString(new DashboardUpdateRequest(List.of("calendar_today", "my_tasks")));

    mvc.perform(
            put("/api/v1/me/dashboard")
                .header("Authorization", "Bearer " + tokenFor(userId))
                .contentType(MediaType.APPLICATION_JSON)
                .content(body))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.widgets[0]").value("calendar_today"));

    mvc.perform(get("/api/v1/me/dashboard").header("Authorization", "Bearer " + tokenFor(userId)))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.widgets[0]").value("calendar_today"))
        .andExpect(jsonPath("$.widgets[1]").value("my_tasks"))
        .andExpect(jsonPath("$.widgets.length()").value(2));
  }

  @Test
  void put_rejects_unknown_only() throws Exception {
    long userId = createUser("f");
    String body = om.writeValueAsString(new DashboardUpdateRequest(List.of("bogus_widget")));

    mvc.perform(
            put("/api/v1/me/dashboard")
                .header("Authorization", "Bearer " + tokenFor(userId))
                .contentType(MediaType.APPLICATION_JSON)
                .content(body))
        .andExpect(status().isBadRequest());
  }
}
