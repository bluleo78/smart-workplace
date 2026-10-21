package com.workplace.auth.controller;

import static com.workplace.jooq.Tables.AGENT_API_KEY;
import static com.workplace.jooq.Tables.AI_AGENT_CREDENTIAL;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.authentication;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workplace.auth.repository.AgentApiKeyRepository;
import com.workplace.global.tenant.TenantContext;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.util.List;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.RequestBuilder;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.transaction.annotation.Transactional;

/**
 * WP-703 — 관리자 AI 관리 API(키 목록·발급·회수, AI 연결 등록·회수·조회, 모델 목록, 공용 비서 지정)는 대상 AI 가 지금 워크스페이스의 구성원일 때만
 * 동작한다. user 는 전역 테이블이라 id 만으로 다른 워크스페이스의 AI 를 건드릴 수 있었다 — 이름 변경·삭제(#811)처럼 404 로 존재도 숨긴다.
 */
@Transactional
class AdminAgentCrossTenantTest extends IntegrationTestBase {

  @Autowired MockMvc mvc;
  @Autowired DSLContext dsl;
  @Autowired AgentApiKeyRepository keyRepo;

  private long admin;
  private long homeAgent;
  private long foreignAgent;

  @BeforeEach
  void seed() {
    TenantContext.set(1L);
    admin = TestFixtures.createHuman(dsl);
    TestFixtures.addMember(dsl, admin, 1L);
    homeAgent = TestFixtures.createAgentNoToken(dsl);
    TestFixtures.addMember(dsl, homeAgent, 1L);
    // 다른 워크스페이스에만 속한 AI — 이 워크스페이스(1) 관리자에게는 없는 것과 같아야 한다.
    long otherTenant = TestFixtures.createTenant(dsl, "ACTIVE");
    foreignAgent = TestFixtures.createAgentNoToken(dsl);
    TestFixtures.addMember(dsl, foreignAgent, otherTenant);
  }

  @AfterEach
  void clearTenant() {
    TenantContext.clear();
  }

  private ResultActions call(MockHttpServletRequestBuilder req) throws Exception {
    // 요청 필터 체인이 끝나면 TenantContext 가 비워지므로 호출마다 tenant#1 로 다시 맞춘다.
    TenantContext.set(1L);
    RequestBuilder built =
        req.with(authentication(adminAuth())).contentType(MediaType.APPLICATION_JSON);
    return mvc.perform(built);
  }

  private UsernamePasswordAuthenticationToken adminAuth() {
    return new UsernamePasswordAuthenticationToken(
        admin, "n/a", List.of(new SimpleGrantedAuthority("user:write")));
  }

  @Test
  void 다른_워크스페이스_AI_의_키는_보지도_만들지도_회수하지도_못한다() throws Exception {
    Long foreignKey =
        keyRepo.insert(foreignAgent, "ak_foreign01", "hash-wp703", "A 관리자 키", foreignAgent);
    String keys = "/api/v1/admin/agents/" + foreignAgent + "/keys";

    call(get(keys)).andExpect(status().isNotFound());
    call(post(keys).content("{\"label\":\"mallory\"}")).andExpect(status().isNotFound());
    call(delete(keys + "/" + foreignKey)).andExpect(status().isNotFound());

    // 발급된 키가 없고, 원래 키도 회수되지 않았다.
    assertThat(dsl.fetchCount(AGENT_API_KEY, AGENT_API_KEY.USER_ID.eq(foreignAgent))).isEqualTo(1);
    assertThat(
            dsl.select(AGENT_API_KEY.REVOKED_AT)
                .from(AGENT_API_KEY)
                .where(AGENT_API_KEY.ID.eq(foreignKey))
                .fetchOne(AGENT_API_KEY.REVOKED_AT))
        .isNull();
  }

  @Test
  void 다른_워크스페이스_AI_의_연결과_모델은_다루지_못한다() throws Exception {
    String cred = "/api/v1/admin/agents/" + foreignAgent + "/provider-credential";

    call(post(cred).content("{\"provider\":\"anthropic\",\"token\":\"" + "x".repeat(40) + "\"}"))
        .andExpect(status().isNotFound());
    call(get(cred)).andExpect(status().isNotFound());
    call(delete(cred)).andExpect(status().isNotFound());
    call(get("/api/v1/admin/agents/" + foreignAgent + "/models")).andExpect(status().isNotFound());

    assertThat(dsl.fetchCount(AI_AGENT_CREDENTIAL, AI_AGENT_CREDENTIAL.USER_ID.eq(foreignAgent)))
        .isZero();
  }

  @Test
  void 다른_워크스페이스_AI_는_공용_비서로_지정하지_못한다() throws Exception {
    call(put("/api/v1/admin/workspace-assistant").content("{\"agentUserId\":" + foreignAgent + "}"))
        .andExpect(status().isNotFound());
  }

  @Test
  void 이_워크스페이스_AI_의_키는_그대로_다룬다() throws Exception {
    String keys = "/api/v1/admin/agents/" + homeAgent + "/keys";
    call(post(keys).content("{\"label\":\"우리 키\"}")).andExpect(status().isOk());
    call(get(keys)).andExpect(status().isOk());
    assertThat(dsl.fetchCount(AGENT_API_KEY, AGENT_API_KEY.USER_ID.eq(homeAgent))).isEqualTo(1);
  }
}
