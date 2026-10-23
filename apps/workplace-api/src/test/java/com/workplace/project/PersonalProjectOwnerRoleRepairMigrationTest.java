package com.workplace.project;

import static com.workplace.jooq.Tables.PROJECT_MEMBER;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.project.dto.AddMemberRequest;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.service.ProjectService;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.core.io.ClassPathResource;
import org.springframework.transaction.annotation.Transactional;

/**
 * V203(WP-856) — 역할 변경 API 결함으로 AGENT 가 OWNER, 주인이 MEMBER 가 된 개인 프로젝트를 주인만 OWNER 인 상태로 되돌리는 데이터 정리.
 *
 * <p>Testcontainers 는 빈 DB 에서 마이그레이션을 돌려 정리 대상이 없으므로, 결함이 남긴 상태를 시드한 뒤 같은 SQL 파일을 다시 실행해 결과를 확인한다.
 */
@Transactional
class PersonalProjectOwnerRoleRepairMigrationTest extends IntegrationTestBase {

  private static final String MIGRATION =
      "db/migration/V203__personal_project_owner_role_repair.sql";

  @Autowired DSLContext dsl;
  @Autowired ProjectService projectService;

  /** 개인 프로젝트는 주인만 OWNER 로 되돌리고, 팀 프로젝트의 AGENT OWNER 는 건드리지 않는다. */
  @Test
  void repairsPersonalProjectOwnerRoles_leavesTeamProjects() throws IOException {
    long owner = withMembership(TestFixtures.createHuman(dsl));
    Long agent = createAgentUserWithMembership("bot-v203");
    var personal =
        projectService.create(owner, new CreateProjectRequest(null, "개인V203", null, "PERSONAL"));
    projectService.addMember(owner, personal.key(), new AddMemberRequest(agent, "MEMBER"));
    String teamKey =
        "RP" + UUID.randomUUID().toString().replace("-", "").toUpperCase().substring(0, 6);
    var team = projectService.create(owner, new CreateProjectRequest(teamKey, "팀V203", null));
    projectService.addMember(owner, team.key(), new AddMemberRequest(agent, "OWNER"));
    // 결함이 남긴 상태: 개인 프로젝트의 AGENT 가 OWNER, 주인이 MEMBER.
    setRole(personal.id(), agent, "OWNER");
    setRole(personal.id(), owner, "MEMBER");

    dsl.execute(new ClassPathResource(MIGRATION).getContentAsString(StandardCharsets.UTF_8));

    assertThat(role(personal.id(), owner)).isEqualTo("OWNER");
    assertThat(role(personal.id(), agent)).isEqualTo("MEMBER");
    assertThat(role(team.id(), agent)).isEqualTo("OWNER");
  }

  private void setRole(Long projectId, Long userId, String role) {
    dsl.update(PROJECT_MEMBER)
        .set(PROJECT_MEMBER.ROLE, role)
        .where(PROJECT_MEMBER.PROJECT_ID.eq(projectId))
        .and(PROJECT_MEMBER.USER_ID.eq(userId))
        .execute();
  }

  private String role(Long projectId, Long userId) {
    return dsl.select(PROJECT_MEMBER.ROLE)
        .from(PROJECT_MEMBER)
        .where(PROJECT_MEMBER.PROJECT_ID.eq(projectId))
        .and(PROJECT_MEMBER.USER_ID.eq(userId))
        .fetchOne(PROJECT_MEMBER.ROLE);
  }
}
