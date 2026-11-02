package com.workplace.agentruntime;

import static com.workplace.jooq.Tables.PROJECT;
import static com.workplace.jooq.Tables.PROJECT_MEMBER;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.authentication;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workplace.auth.repository.AgentApiKeyRepository;
import com.workplace.auth.service.AgentApiKeyService;
import com.workplace.global.tenant.TenantContext;
import com.workplace.global.util.CapabilityTokens;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import com.workplace.support.WebSessionAuth;
import java.util.List;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.transaction.annotation.Transactional;

/**
 * WP-1275 맡는 프로젝트 API 통합 테스트 — AI 가 자기 키로 {@code GET /api/v1/agent-runtime/me/projects} 를 부르면 실제
 * 멤버이고 연결된 저장소가 있으며 키가 작업 공간 이름 형식인 프로젝트만 키 순으로 받는다. 사람은 403.
 */
@Transactional
class AgentAssignedProjectsApiTest extends IntegrationTestBase {

  private static final String URL = "/api/v1/agent-runtime/me/projects";

  @Autowired MockMvc mvc;
  @Autowired DSLContext dsl;
  @Autowired AgentApiKeyService keyService;
  @Autowired AgentApiKeyRepository keyRepo;

  private long admin;
  private long agent;
  private String key;

  /** 다른 테스트의 프로젝트 키와 겹치지 않게 붙이는 꼬리. */
  private String s;

  @BeforeEach
  void seed() {
    TenantContext.set(1L);
    admin = TestFixtures.activeMemberOfCurrentTenant(dsl, TestFixtures.createHuman(dsl));
    agent = TestFixtures.activeMemberOfCurrentTenant(dsl, TestFixtures.createAgentNoToken(dsl));
    key = keyService.issueManaged(agent, 1L, null, null, "L1").plaintext();
    s = String.valueOf(System.nanoTime() % 100000);
  }

  /** 테넌트 1 에 프로젝트를 만든다(저장소 주소는 null 가능). */
  private long project(String projectKey, String repositoryUrl, String branch) {
    TenantContext.set(1L);
    return dsl.insertInto(PROJECT)
        .set(PROJECT.KEY, projectKey)
        .set(PROJECT.NAME, "프로젝트 " + projectKey)
        .set(PROJECT.OWNER_ID, admin)
        .set(PROJECT.TYPE, "TEAM")
        .set(PROJECT.REPOSITORY_URL, repositoryUrl)
        .set(PROJECT.REPOSITORY_BRANCH, branch)
        .returning(PROJECT.ID)
        .fetchOne()
        .getId();
  }

  private void addMember(long projectId) {
    dsl.insertInto(PROJECT_MEMBER)
        .set(PROJECT_MEMBER.PROJECT_ID, projectId)
        .set(PROJECT_MEMBER.USER_ID, agent)
        .set(PROJECT_MEMBER.ROLE, "MEMBER")
        .execute();
  }

  /** AI 키로 부른다 — 필터가 TenantContext 를 비우므로 앞뒤로 GUC 를 테넌트 1 로 맞춘다. */
  private ResultActions callAsAgent() throws Exception {
    useTenant(1L);
    ResultActions r = mvc.perform(get(URL).header("Authorization", "Bearer " + key));
    useTenant(1L);
    return r;
  }

  /** 멤버이고 저장소가 있는 프로젝트만 키 순 — 저장소 없음·멤버 아님·키 형식 위반은 빠진다. */
  @Test
  void projects_returnsOnlyMemberProjectsWithRepositoryAndValidKey() throws Exception {
    long b = project("ZB" + s, "https://github.com/acme/b.git", null);
    long a = project("ZA" + s, "https://github.com/acme/a.git", "develop");
    long noRepo = project("ZC" + s, null, null);
    project("ZD" + s, "https://github.com/acme/d.git", null); // 멤버 아님
    long badKey = project("Z." + s, "https://github.com/acme/e.git", null); // 폴더·칸 이름이 될 수 없는 키
    addMember(b);
    addMember(a);
    addMember(noRepo);
    addMember(badKey);

    callAsAgent()
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.length()").value(2))
        .andExpect(jsonPath("$[0].projectKey").value("ZA" + s))
        .andExpect(jsonPath("$[0].repositoryUrl").value("https://github.com/acme/a.git"))
        .andExpect(jsonPath("$[0].repositoryBranch").value("develop"))
        .andExpect(jsonPath("$[1].projectKey").value("ZB" + s))
        .andExpect(jsonPath("$[1].repositoryBranch").isEmpty());
  }

  /** 맡는 프로젝트가 없으면 빈 목록(200). */
  @Test
  void projects_withoutAssignedProjects_returnsEmptyList() throws Exception {
    callAsAgent().andExpect(status().isOk()).andExpect(jsonPath("$.length()").value(0));
  }

  /**
   * 두 워크스페이스에 속한 AI 가 워크스페이스에 묶이지 않은 키로 헤더 없이 부르면 400 — 빈 목록이면 「맡은 프로젝트 없음」과 구분되지 않아 칸을 띄우지 않고
   * 넘어간다.
   */
  @Test
  void projects_forAgentInTwoTenantsWithoutTenant_returns400() throws Exception {
    long tenant2 = TestFixtures.createTenant(dsl, "ACTIVE");
    TestFixtures.ensureActiveMember(dsl, agent, tenant2);
    String unbound = "ak_unboundProjectsKey00001";
    keyRepo.insert(
        agent, unbound.substring(0, 12), CapabilityTokens.sha256Hex(unbound), "수동", admin);
    // 테스트 스레드에 남은 TenantContext 가 해석을 대신하지 않게 비운다.
    TenantContext.clear();
    mvc.perform(get(URL).header("Authorization", "Bearer " + unbound))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.errors.code").value("AGENT_WORKSPACE_REQUIRED"));
    useTenant(1L);
  }

  /** 사람은 부를 수 없다 — 403. */
  @Test
  void projects_fromHuman_returns403() throws Exception {
    TenantContext.set(1L);
    mvc.perform(get(URL).with(authentication(WebSessionAuth.of(admin, List.of()))))
        .andExpect(status().isForbidden())
        .andExpect(jsonPath("$.errors.code").value("AGENT_PROJECTS_AGENT_ONLY"));
  }
}
