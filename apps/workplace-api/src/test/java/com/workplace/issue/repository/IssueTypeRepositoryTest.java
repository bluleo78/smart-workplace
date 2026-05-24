package com.workplace.issue.repository;

import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.issue.dto.IssueTypeRow;
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

/** IssueTypeRepository 통합 테스트 — CRUD + batch 조회 + count 검증. */
@Transactional
class IssueTypeRepositoryTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired IssueTypeRepository repo;
  @Autowired IssueRepository issueRepository;
  @Autowired ProjectService projectService;

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

  private ProjectResponse newProject(Long ownerId, String prefix) {
    return projectService.create(
        ownerId, new CreateProjectRequest(uniqueKey(prefix), "P-" + prefix, "x"));
  }

  @Test
  void find_by_project_returns_seeded_system_types() {
    // ProjectService.create 가 시스템 5종(Phase 4a SUBTASK 포함)을 시드 — position 순서 보장.
    Long owner = createUser("a");
    ProjectResponse p = newProject(owner, "TYA");

    List<IssueTypeRow> types = repo.findByProject(p.id());

    assertThat(types).hasSize(5);
    assertThat(types)
        .extracting(IssueTypeRow::name)
        .containsExactly("TASK", "BUG", "STORY", "CHORE", "SUBTASK");
    assertThat(types).allMatch(IssueTypeRow::isSystem);
  }

  @Test
  void insert_custom_and_find_by_name() {
    Long owner = createUser("b");
    ProjectResponse p = newProject(owner, "TYB");
    var inserted = repo.insert(p.id(), "DESIGN", "PURPLE", "Star", false, 99);

    var found = repo.findByProjectAndName(p.id(), "DESIGN");

    assertThat(found).isPresent();
    assertThat(found.get().id()).isEqualTo(inserted.id());
    assertThat(found.get().isSystem()).isFalse();
  }

  @Test
  void count_issues_by_type_returns_zero_for_unused() {
    Long owner = createUser("c");
    ProjectResponse p = newProject(owner, "TYC");
    var t = repo.insert(p.id(), "DESIGN", "PURPLE", "Star", false, 99);

    assertThat(repo.countIssuesByType(t.id())).isZero();
  }

  @Test
  void find_by_ids_returns_summaries_for_input_set() {
    Long owner = createUser("d");
    ProjectResponse p = newProject(owner, "TYD");
    var a = repo.insert(p.id(), "DESIGN", "PURPLE", "Star", false, 10);
    var b = repo.insert(p.id(), "OPS", "GRAY", "Wrench", false, 11);

    var map = repo.findByIds(List.of(a.id(), b.id()));

    assertThat(map).hasSize(2);
    assertThat(map.get(a.id()).name()).isEqualTo("DESIGN");
    assertThat(map.get(b.id()).icon()).isEqualTo("Wrench");
  }
}
