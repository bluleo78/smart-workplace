package com.workplace.auth.controller;

import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.authentication;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.global.tenant.TenantContext;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.transaction.annotation.Transactional;

/**
 * WP-455 — 관리자가 AI 의 설명(역할)을 적고 고치는 API 통합 테스트. 이름 변경 요청(PUT /admin/agents/{id})에 함께 실려 저장되고, 에이전트
 * 목록에 그대로 돌아오며, 비우면 지워지고 빠지면 그대로 두며 500자를 넘으면 400 으로 거른다.
 */
@Transactional
class AdminAgentDescriptionControllerTest extends IntegrationTestBase {

  @Autowired MockMvc mvc;
  @Autowired DSLContext dsl;
  @Autowired ObjectMapper objectMapper;

  private long admin;
  private long agent;
  private String agentUsername;

  @BeforeEach
  void seed() {
    TenantContext.set(1L);
    admin = TestFixtures.createHuman(dsl);
    TestFixtures.addMember(dsl, admin, 1L);
    agent = TestFixtures.createAgentNoToken(dsl);
    TestFixtures.addMember(dsl, agent, 1L);
    agentUsername =
        dsl.select(USER.USERNAME).from(USER).where(USER.ID.eq(agent)).fetchOne(USER.USERNAME);
  }

  @AfterEach
  void clearTenant() {
    TenantContext.clear();
  }

  private ResultActions putIdentity(String description) throws Exception {
    Map<String, Object> body = new HashMap<>();
    body.put("description", description);
    return putIdentity(body);
  }

  /** username·name 은 그대로 두고 나머지 필드만 body 로 보낸다 — description 을 빼는 옛 화면 요청도 재현한다. */
  private ResultActions putIdentity(Map<String, Object> body) throws Exception {
    // 요청 필터 체인이 끝나면 TenantContext 가 비워지므로 호출마다 tenant#1 로 다시 맞춘다.
    TenantContext.set(1L);
    body.put("username", agentUsername);
    body.put("name", "리뷰봇");
    return mvc.perform(
        put("/api/v1/admin/agents/" + agent)
            .with(authentication(adminAuth()))
            .contentType(MediaType.APPLICATION_JSON)
            .content(objectMapper.writeValueAsString(body)));
  }

  private UsernamePasswordAuthenticationToken adminAuth() {
    return new UsernamePasswordAuthenticationToken(
        admin, "n/a", List.of(new SimpleGrantedAuthority("user:write")));
  }

  private String descriptionOf() {
    return dsl.select(USER.DESCRIPTION)
        .from(USER)
        .where(USER.ID.eq(agent))
        .fetchOne(USER.DESCRIPTION);
  }

  @Test
  void 설명을_저장하면_앞뒤_공백을_걷고_목록에_그대로_돌아온다() throws Exception {
    putIdentity("  코드 리뷰를 맡습니다.  ").andExpect(status().isNoContent());
    assertThat(descriptionOf()).isEqualTo("코드 리뷰를 맡습니다.");

    TenantContext.set(1L);
    mvc.perform(get("/api/v1/admin/agents").with(authentication(adminAuth())))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$[?(@.id == " + agent + ")].description").value("코드 리뷰를 맡습니다."));
  }

  @Test
  void 설명을_비우면_지워진다() throws Exception {
    putIdentity("코드 리뷰를 맡습니다.").andExpect(status().isNoContent());
    putIdentity("   ").andExpect(status().isNoContent());
    assertThat(descriptionOf()).isNull();
  }

  @Test
  void 설명_칸이_빠진_요청은_설명을_그대로_둔다() throws Exception {
    // 설명 칸을 모르는 옛 화면(배포 중·캐시된 PWA)이 이름만 바꿔도 다른 AI 가 읽는 설명이 지워지면 안 된다.
    putIdentity("코드 리뷰를 맡습니다.").andExpect(status().isNoContent());
    putIdentity(new HashMap<>()).andExpect(status().isNoContent());
    assertThat(descriptionOf()).isEqualTo("코드 리뷰를 맡습니다.");
  }

  @Test
  void 설명이_500자를_넘으면_400() throws Exception {
    putIdentity("가".repeat(501)).andExpect(status().isBadRequest());
    assertThat(descriptionOf()).isNull();
  }
}
