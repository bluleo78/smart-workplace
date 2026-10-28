package com.workplace.auth.controller;

import static com.workplace.jooq.Tables.MEMBERSHIP;
import static com.workplace.jooq.Tables.WORKSPACE_ASSISTANT;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.authentication;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workplace.auth.repository.WorkspaceAssistantRepository;
import com.workplace.auth.service.AiAgentCredentialService;
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
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.transaction.annotation.Transactional;

/**
 * WP-1075 — 에이전트 상세가 활성 상태를 다루고 정지된 AI 도 목록에 보이게 되면서 생긴 두 가드. 공통 비서는 지정을 풀기 전에 끌 수 없고(공통 AI 대화가 정지된
 * AI 로 돌지 않게), 정지된 AI 는 공통 비서로 지정할 수 없다. 정지된 AI 는 목록에 비활성으로 남고 다시 켜면 활성으로 돌아온다.
 */
@Transactional
class AgentAccessGuardTest extends IntegrationTestBase {

  @Autowired MockMvc mvc;
  @Autowired DSLContext dsl;
  @Autowired WorkspaceAssistantRepository assistantRepo;
  @Autowired AiAgentCredentialService credentialService;

  private long admin;

  @BeforeEach
  void seed() {
    TenantContext.set(1L);
    admin = TestFixtures.createHuman(dsl);
    TestFixtures.grantRole(dsl, admin, "ADMIN");
    TestFixtures.addMember(dsl, admin, 1L);
  }

  @AfterEach
  void clearTenant() {
    TenantContext.clear();
  }

  private ResultActions call(MockHttpServletRequestBuilder req) throws Exception {
    // 요청 필터 체인이 끝나면 TenantContext 가 비워지므로 호출마다 tenant#1 로 다시 맞춘다.
    TenantContext.set(1L);
    var auth =
        new UsernamePasswordAuthenticationToken(
            admin, "n/a", List.of(new SimpleGrantedAuthority("user:write")));
    ResultActions r =
        mvc.perform(req.with(authentication(auth)).contentType(MediaType.APPLICATION_JSON));
    TenantContext.set(1L);
    return r;
  }

  private long agentHere() {
    long agent = TestFixtures.createAgentWithToken(dsl, credentialService, admin);
    TestFixtures.addMember(dsl, agent, 1L);
    return agent;
  }

  @Test
  void 공통_비서는_지정을_풀기_전에_비활성화할_수_없다() throws Exception {
    long agent = agentHere();
    assistantRepo.upsert(agent, admin);

    call(put("/api/v1/users/" + agent + "/active").content("{\"active\":false}"))
        .andExpect(status().isConflict())
        .andExpect(jsonPath("$.message").value("공통 비서는 지정을 해제한 뒤 비활성화할 수 있습니다"));
    assertThat(TestFixtures.membershipStatus(dsl, agent, 1L)).isEqualTo("ACTIVE");
  }

  @Test
  void 공통_비서가_아닌_AI_는_끄면_목록에_비활성으로_남고_다시_켜면_활성이다() throws Exception {
    long agent = agentHere();

    call(put("/api/v1/users/" + agent + "/active").content("{\"active\":false}"))
        .andExpect(status().isNoContent());
    call(get("/api/v1/admin/agents"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$[?(@.id == " + agent + ")].isActive").value(false));

    call(put("/api/v1/users/" + agent + "/active").content("{\"active\":true}"))
        .andExpect(status().isNoContent());
    call(get("/api/v1/admin/agents"))
        .andExpect(jsonPath("$[?(@.id == " + agent + ")].isActive").value(true));
  }

  @Test
  void 정지된_AI_는_공통_비서로_지정할_수_없다() throws Exception {
    long agent = agentHere();
    dsl.update(MEMBERSHIP)
        .set(MEMBERSHIP.STATUS, "SUSPENDED")
        .where(MEMBERSHIP.USER_ID.eq(agent).and(MEMBERSHIP.TENANT_ID.eq(1L)))
        .execute();

    call(put("/api/v1/admin/workspace-assistant").content("{\"agentUserId\":" + agent + "}"))
        .andExpect(status().isConflict());
    assertThat(dsl.fetchCount(WORKSPACE_ASSISTANT)).isZero();
  }
}
