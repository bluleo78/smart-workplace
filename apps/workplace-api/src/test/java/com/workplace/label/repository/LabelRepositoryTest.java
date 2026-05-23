package com.workplace.label.repository;

import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.dto.ProjectResponse;
import com.workplace.project.service.ProjectService;
import com.workplace.support.IntegrationTestBase;
import java.util.List;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/** LabelRepository 통합 테스트 — insert/findByProject/findByIds 검증. */
@Transactional
class LabelRepositoryTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired LabelRepository labelRepository;
  @Autowired ProjectService projectService;

  /** USER 역할 가진 사용자 직접 INSERT. */
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
  void insert_and_find_by_project_returns_all_for_that_project() {
    Long owner = createUser("la");
    ProjectResponse p1 =
        projectService.create(owner, new CreateProjectRequest(uniqueKey("PA"), "Proj A", "x"));
    ProjectResponse p2 =
        projectService.create(owner, new CreateProjectRequest(uniqueKey("PB"), "Proj B", "x"));
    labelRepository.insert(p1.id(), "버그", "RED");
    labelRepository.insert(p1.id(), "개선", "GREEN");
    labelRepository.insert(p2.id(), "버그", "RED");

    var rows = labelRepository.findByProject(p1.id());
    assertThat(rows).hasSize(2);
  }

  @Test
  void find_by_ids_returns_only_matching() {
    Long owner = createUser("lb");
    ProjectResponse p1 =
        projectService.create(owner, new CreateProjectRequest(uniqueKey("PC"), "Proj C", "x"));
    var a = labelRepository.insert(p1.id(), "라벨A", "RED");
    var b = labelRepository.insert(p1.id(), "라벨B", "BLUE");

    var rows = labelRepository.findByIds(List.of(a.id(), b.id()));
    assertThat(rows).hasSize(2);
  }
}
