package com.workplace.issue.service;

import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.issue.dto.IssueRow;
import com.workplace.issue.exception.DependencyCycleException;
import com.workplace.issue.repository.IssueRepository;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.dto.ProjectResponse;
import com.workplace.project.service.ProjectService;
import com.workplace.support.IntegrationTestBase;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/** Phase 4b — DFS 기반 사이클 검출 (2/3/4-node + 선형 통과). */
@Transactional
class IssueDependencyCycleTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired IssueDependencyService service;
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

  private IssueRow newTask(Long projectId, int number, String title, Long reporterId) {
    return issueRepository.insert(projectId, number, title, "b", "MID", null, reporterId);
  }

  @Test
  void direct_cycle_two_nodes_throws_409() {
    Long owner = createUser("c1");
    var p = newProject(owner, "C1");
    newTask(p.id(), 1, "a", owner);
    newTask(p.id(), 2, "b", owner);

    service.add(owner, p.key(), 1, 2, "blocks"); // A→B
    assertThatThrownBy(() -> service.add(owner, p.key(), 2, 1, "blocks")) // B→A
        .isInstanceOf(DependencyCycleException.class);
  }

  @Test
  void indirect_cycle_three_nodes_throws_409() {
    Long owner = createUser("c2");
    var p = newProject(owner, "C2");
    newTask(p.id(), 1, "a", owner);
    newTask(p.id(), 2, "b", owner);
    newTask(p.id(), 3, "c", owner);

    service.add(owner, p.key(), 1, 2, "blocks"); // A→B
    service.add(owner, p.key(), 2, 3, "blocks"); // B→C
    assertThatThrownBy(() -> service.add(owner, p.key(), 3, 1, "blocks")) // C→A
        .isInstanceOf(DependencyCycleException.class);
  }

  @Test
  void indirect_cycle_four_nodes_throws_409() {
    Long owner = createUser("c3");
    var p = newProject(owner, "C3");
    newTask(p.id(), 1, "a", owner);
    newTask(p.id(), 2, "b", owner);
    newTask(p.id(), 3, "c", owner);
    newTask(p.id(), 4, "d", owner);

    service.add(owner, p.key(), 1, 2, "blocks");
    service.add(owner, p.key(), 2, 3, "blocks");
    service.add(owner, p.key(), 3, 4, "blocks");
    assertThatThrownBy(() -> service.add(owner, p.key(), 4, 1, "blocks"))
        .isInstanceOf(DependencyCycleException.class);
  }

  @Test
  void linear_chain_ok() {
    Long owner = createUser("c4");
    var p = newProject(owner, "C4");
    newTask(p.id(), 1, "a", owner);
    newTask(p.id(), 2, "b", owner);
    newTask(p.id(), 3, "c", owner);
    newTask(p.id(), 4, "d", owner);

    assertThatCode(
            () -> {
              service.add(owner, p.key(), 1, 2, "blocks");
              service.add(owner, p.key(), 2, 3, "blocks");
              service.add(owner, p.key(), 3, 4, "blocks");
            })
        .doesNotThrowAnyException();
  }
}
