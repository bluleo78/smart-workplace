package com.workplace.user.service;

import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.repository.ProjectMemberRepository;
import com.workplace.project.service.ProjectService;
import com.workplace.support.IntegrationTestBase;
import com.workplace.user.dto.CreateAgentRequest;
import java.util.List;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;

/**
 * WP-252 — 관리 화면(UserService.createAgent)으로 만든 에이전트가 기본 AGENT 역할을 받아, 멤버인 프로젝트의 이슈를 조회할 수 있어야 한다.
 *
 * <p>이전엔 역할 0개로 생성돼 project:read 가 없어 ai-agent 콜백(이슈 조회)이 403 이었다. 서비스 직접 호출은 컨트롤러의
 * {@code @RequirePermission} 게이트를 우회하므로, ai-agent 콜백과 같은 Internal 토큰 + X-On-Behalf-Of 로 MockMvc 호출해
 * 필터→권한 인터셉터 전 구간을 검증한다. 시드는 @Transactional 롤백으로 회수된다.
 */
@Transactional
class AdminAgentIssueAccessTest extends IntegrationTestBase {

  /** application-test.yml 의 workplace.ai-agent.internal-token 값. */
  private static final String INTERNAL_TOKEN = "test-token";

  @Autowired private MockMvc mockMvc;
  @Autowired private UserService userService;
  @Autowired private ProjectService projectService;
  @Autowired private ProjectMemberRepository memberRepository;
  @Autowired private DSLContext dsl;

  /** 프로젝트 소유자가 될 HUMAN 유저(테넌트#1 멤버). */
  private Long createHumanOwner() {
    String suffix = UUID.randomUUID().toString().substring(0, 8);
    Long id =
        dsl.insertInto(USER)
            .set(USER.USERNAME, "owner-" + suffix)
            .set(USER.PASSWORD, "pw")
            .set(USER.NAME, "Owner")
            .set(USER.EMAIL, "owner-" + suffix + "@example.com")
            .returning(USER.ID)
            .fetchOne()
            .getId();
    Long roleId = dsl.select(ROLE.ID).from(ROLE).where(ROLE.NAME.eq("USER")).fetchOne(ROLE.ID);
    dsl.insertInto(USER_ROLE).set(USER_ROLE.USER_ID, id).set(USER_ROLE.ROLE_ID, roleId).execute();
    return withMembership(id);
  }

  /** 실제 관리자 생성 경로로 에이전트를 만든다. */
  private Long createAdminAgent() {
    String suffix = UUID.randomUUID().toString().substring(0, 8);
    return userService
        .createAgent(
            null,
            new CreateAgentRequest("biz-" + suffix, "업무 에이전트", "biz-" + suffix + "@example.com"))
        .id();
  }

  @Test
  @DisplayName("createAgent 는 기본 AGENT 역할을 부여한다")
  void createAgent_grantsAgentRole() {
    Long agentId = createAdminAgent();

    List<String> roleNames =
        dsl.select(ROLE.NAME)
            .from(USER_ROLE)
            .join(ROLE)
            .on(ROLE.ID.eq(USER_ROLE.ROLE_ID))
            .where(USER_ROLE.USER_ID.eq(agentId))
            .fetch(ROLE.NAME);
    assertThat(roleNames).containsExactly("AGENT");
  }

  @Test
  @DisplayName("createAgent 로 만든 에이전트가 멤버인 프로젝트의 이슈 목록을 조회할 수 있다(403 아님)")
  void adminCreatedAgent_canListProjectIssues() throws Exception {
    Long ownerId = createHumanOwner();
    Long agentId = createAdminAgent();
    String key = "AG" + UUID.randomUUID().toString().replace("-", "").toUpperCase().substring(0, 4);
    var project = projectService.create(ownerId, new CreateProjectRequest(key, "에이전트 접근", "x"));
    memberRepository.insert(project.id(), agentId, "MEMBER");

    mockMvc
        .perform(
            get("/api/v1/projects/" + project.key() + "/issues")
                .header("Authorization", "Internal " + INTERNAL_TOKEN)
                .header("X-On-Behalf-Of", String.valueOf(agentId)))
        .andExpect(status().isOk());
  }
}
