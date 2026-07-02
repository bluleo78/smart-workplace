package com.workplace.issue.service;

import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.issue.dto.IssueTypeRow;
import com.workplace.issue.repository.IssueTypeRepository;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.service.PersonalProjectProvisioner;
import com.workplace.project.service.ProjectService;
import com.workplace.support.IntegrationTestBase;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/** ProjectService.create(공유 프로젝트)가 시스템 유형 6종(EPIC 포함)을 시드하는지 검증. */
@Transactional
class IssueTypeSystemSeedTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired ProjectService projectService;
  @Autowired IssueTypeRepository typeRepository;
  @Autowired PersonalProjectProvisioner personalProjectProvisioner;

  private Long createUser(String prefix) {
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

  private String uniqueKey(String prefix) {
    String suffix = UUID.randomUUID().toString().replaceAll("-", "").toUpperCase().substring(0, 4);
    String key = prefix + suffix;
    return key.substring(0, Math.min(10, key.length()));
  }

  @Test
  void create_project_seeds_6_system_types() {
    Long ownerId = createUser("seed");
    var project =
        projectService.create(ownerId, new CreateProjectRequest(uniqueKey("SD"), "Seed", "x"));

    var types = typeRepository.findByProject(project.id());

    assertThat(types).hasSize(6);
    assertThat(types)
        .extracting(IssueTypeRow::name)
        .containsExactlyInAnyOrder("TASK", "BUG", "STORY", "CHORE", "SUBTASK", "EPIC");
    assertThat(types).allMatch(IssueTypeRow::isSystem);
  }

  @Test
  void personal_project_does_not_seed_epic() {
    // PersonalProjectProvisioner 경로(HUMAN 회원가입 시 기본 개인 프로젝트 등)로 실제 PERSONAL
    // 프로젝트를 생성해 includeEpic=false 계약을 검증한다. EPIC 미포함 + 나머지 5종(SUBTASK 포함)은
    // 정상 시드되었는지 함께 확인해 "아무것도 시드되지 않아 우연히 통과"하는 공허 케이스를 배제한다.
    Long ownerId = createUser("seed2");
    var project = personalProjectProvisioner.createPersonal(ownerId, "개인 작업", null, true);

    var types = typeRepository.findByProject(project.id());
    assertThat(types).extracting(IssueTypeRow::name).doesNotContain("EPIC");
    assertThat(types).extracting(IssueTypeRow::name).contains("SUBTASK");
  }
}
