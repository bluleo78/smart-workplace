package com.workplace.auth.controller;

import static com.workplace.jooq.Tables.AGENT_API_KEY;
import static com.workplace.jooq.Tables.AI_AGENT_CREDENTIAL;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.WORKSPACE_ASSISTANT;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.authentication;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workplace.auth.repository.AgentApiKeyRepository;
import com.workplace.auth.repository.WorkspaceAssistantRepository;
import com.workplace.auth.service.AiAgentCredentialService;
import com.workplace.global.tenant.TenantContext;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import com.workplace.user.dto.AgentUsernames;
import com.workplace.wiki.service.WikiSpaceService;
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
 * WP-705 — AI 에이전트 삭제. 일한 기록이 없으면 완전히 지우고, 기록이 남아 지울 수 없으면 사용 중지(이 워크스페이스 멤버십 정지·키·AI 연결 회수·목록에는
 * 비활성으로 남김, WP-1075)로 대신한다. 예전엔 FK 에 막혀 영어 409 만 떴다. 공통 비서 지정은 먼저 해제하고, 다른 워크스페이스에도 속한 AI 는 지우지
 * 않는다.
 */
@Transactional
class AdminAgentDeleteTest extends IntegrationTestBase {

  @Autowired MockMvc mvc;
  @Autowired DSLContext dsl;
  @Autowired AgentApiKeyRepository keyRepo;
  @Autowired WikiSpaceService wikiSpaceService;
  @Autowired WorkspaceAssistantRepository assistantRepo;
  @Autowired AiAgentCredentialService credentialService;

  private long admin;

  @BeforeEach
  void seed() {
    TenantContext.set(1L);
    admin = TestFixtures.createHuman(dsl);
    TestFixtures.grantRole(dsl, admin, "ADMIN"); // WP-729: AI 관리는 ADMIN 만
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
    keyRepo.insert(agent, "ak_" + agent, "hash-" + agent, "키", admin);
    return agent;
  }

  /**
   * 이 AI 가 남긴 기록 — 노트 목록을 열 때 생기는 개인 노트 공간(wiki_space.owner_id 가 user 를 NO ACTION 으로 가리킨다). 감사 로그는
   * user_id 가 ON DELETE SET NULL(V196)이라 삭제를 막지 않는다.
   */
  private void leaveRecord(long agent) {
    wikiSpaceService.ensurePersonalSpace(agent);
  }

  private boolean userExists(long id) {
    return dsl.fetchExists(USER, USER.ID.eq(id));
  }

  private long activeKeys(long agent) {
    return dsl.fetchCount(
        AGENT_API_KEY, AGENT_API_KEY.USER_ID.eq(agent).and(AGENT_API_KEY.REVOKED_AT.isNull()));
  }

  private long activeCredentials(long agent) {
    return dsl.fetchCount(
        AI_AGENT_CREDENTIAL,
        AI_AGENT_CREDENTIAL.USER_ID.eq(agent).and(AI_AGENT_CREDENTIAL.REVOKED_AT.isNull()));
  }

  @Test
  void 기록이_없는_AI_는_완전히_지운다() throws Exception {
    long agent = agentHere();

    call(delete("/api/v1/admin/agents/" + agent))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.result").value("DELETED"));

    assertThat(userExists(agent)).isFalse();
  }

  @Test
  void 공통_비서로만_지정된_AI_는_지정을_풀고_완전히_지운다() throws Exception {
    long agent = agentHere();
    assistantRepo.upsert(agent, admin);

    call(delete("/api/v1/admin/agents/" + agent))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.result").value("DELETED"));

    assertThat(userExists(agent)).isFalse();
    assertThat(dsl.fetchCount(WORKSPACE_ASSISTANT)).isZero();
  }

  @Test
  void 기록이_남은_AI_는_사용을_중지하고_목록에는_비활성으로_남긴다() throws Exception {
    long agent = agentHere();
    assistantRepo.upsert(agent, admin);
    leaveRecord(agent);

    call(delete("/api/v1/admin/agents/" + agent))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.result").value("DEACTIVATED"));

    assertThat(userExists(agent)).isTrue();
    assertThat(TestFixtures.membershipStatus(dsl, agent, 1L)).isEqualTo("SUSPENDED");
    assertThat(activeKeys(agent)).isZero();
    assertThat(activeCredentials(agent)).isZero();
    assertThat(dsl.fetchCount(WORKSPACE_ASSISTANT)).isZero();
    call(get("/api/v1/admin/agents"))
        .andExpect(status().isOk())
        // WP-1075: 목록에서 숨기지 않고 비활성으로 보인다 — 관리자가 에이전트 상세의 활성 상태로 다시 켤 수 있다.
        .andExpect(jsonPath("$[?(@.id == " + agent + ")].isActive").value(false));
  }

  @Test
  void 다른_워크스페이스에도_속한_AI_는_지우지_않고_그쪽_키는_남긴다() throws Exception {
    long agent = agentHere();
    long other = TestFixtures.createTenant(dsl, "ACTIVE");
    TestFixtures.addMember(dsl, agent, other);

    call(delete("/api/v1/admin/agents/" + agent))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.result").value("DEACTIVATED"));

    assertThat(userExists(agent)).isTrue();
    assertThat(TestFixtures.membershipStatus(dsl, agent, 1L)).isEqualTo("SUSPENDED");
    assertThat(TestFixtures.membershipStatus(dsl, agent, other)).isEqualTo("ACTIVE");
    assertThat(activeKeys(agent)).isEqualTo(1);
    assertThat(activeCredentials(agent)).isEqualTo(1);
  }

  @Test
  void 개인_비서는_관리자가_지우지_못한다() throws Exception {
    long agent = agentHere();
    dsl.update(USER)
        .set(USER.USERNAME, AgentUsernames.personalAssistantOf(admin))
        .where(USER.ID.eq(agent))
        .execute();

    call(delete("/api/v1/admin/agents/" + agent)).andExpect(status().isForbidden());

    assertThat(userExists(agent)).isTrue();
    assertThat(TestFixtures.membershipStatus(dsl, agent, 1L)).isEqualTo("ACTIVE");
  }
}
