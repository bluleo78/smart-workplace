package com.workplace.member;

import static com.workplace.jooq.Tables.USER_ROLE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workplace.global.tenant.TenantContext;
import com.workplace.permission.service.PermissionService;
import com.workplace.support.IntegrationTestBase;
import com.workplace.user.dto.CreateAgentRequest;
import com.workplace.user.service.UserService;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;

/**
 * #861 — 역할 없이 생성된 채널 에이전트도 구성원 디렉터리(GET /members)를 조회할 수 있어야 한다.
 *
 * <p>관리자가 /admin/agents 로 만든 에이전트는 역할이 없어 member:read 가 없었고, 그래서 username 해석
 * 도구(open_dm·search_members)가 403 으로 실패했다. 실제 생성 경로(UserService.createAgent)로 에이전트를 만들고 ai-agent
 * 콜백과 같은 Internal 토큰 + X-On-Behalf-Of 로 호출해 필터→권한 인터셉터 전 구간을 검증한다. 시드는 @Transactional 롤백으로 회수된다.
 */
class RolelessAgentMemberDirectoryTest extends IntegrationTestBase {

  /** application-test.yml 의 workplace.ai-agent.internal-token 값. */
  private static final String INTERNAL_TOKEN = "test-token";

  @Autowired private MockMvc mockMvc;
  @Autowired private UserService userService;
  @Autowired private PermissionService permissionService;
  @Autowired private DSLContext dsl;

  /**
   * 실제 관리자 생성 경로로 에이전트를 만든 뒤 역할을 모두 회수해 역할 0개 상태로 만든다. WP-252 부터 createAgent 는 기본 AGENT 역할을 부여하지만,
   * 관리자가 역할을 모두 해제한 에이전트도 멤버십 기반 기본 권한(member:read)은 유지돼야 하므로 그 상태를 재현한다.
   */
  private Long createRolelessAgent() {
    String suffix = UUID.randomUUID().toString().substring(0, 8);
    Long agentId =
        userService
            .createAgent(
                null,
                new CreateAgentRequest(
                    "roleless-" + suffix, "역할없음", "roleless-" + suffix + "@example.com"))
            .id();
    dsl.deleteFrom(USER_ROLE).where(USER_ROLE.USER_ID.eq(agentId)).execute();
    return agentId;
  }

  @Test
  @Transactional
  void rolelessAgent_canReadMemberDirectory() throws Exception {
    Long agentId = createRolelessAgent();

    mockMvc
        .perform(
            get("/api/v1/members")
                .header("Authorization", "Internal " + INTERNAL_TOKEN)
                .header("X-On-Behalf-Of", String.valueOf(agentId)))
        .andExpect(status().isOk());
  }

  /** 기본 권한은 멤버십 기준이라 테넌트 컨텍스트가 없으면 붙지 않는다(fail-closed). */
  @Test
  @Transactional
  void baselinePermission_requiresTenantMembership() {
    Long agentId = createRolelessAgent();
    assertThat(permissionService.getUserPermissions(agentId)).contains("member:read");

    TenantContext.clear();
    try {
      assertThat(permissionService.getUserPermissions(agentId)).doesNotContain("member:read");
    } finally {
      TenantContext.set(1L);
    }
  }
}
