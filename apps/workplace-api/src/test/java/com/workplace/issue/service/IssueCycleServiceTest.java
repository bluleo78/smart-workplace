package com.workplace.issue.service;

import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.cycle.dto.CreateCycleRequest;
import com.workplace.cycle.exception.InvalidCycleForProjectException;
import com.workplace.cycle.service.CycleService;
import com.workplace.issue.dto.CreateIssueRequest;
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

/** IssueCycleService 통합 테스트 — 사이클 집합 교체 + 프로젝트 일관성. */
@Transactional
class IssueCycleServiceTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired IssueCycleService issueCycleService;
  @Autowired CycleService cycleService;
  @Autowired ProjectService projectService;
  @Autowired IssueService issueService;

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

  // 이슈 한 건 생성 후 number 반환. CreateIssueRequest 시그니처: (title, body, priority, dueDate, assigneeIds,
  // typeId, parentNumber).
  private int newIssue(Long owner, ProjectResponse p, String title) {
    var issue =
        issueService.create(
            owner,
            p.key(),
            new CreateIssueRequest(title, null, null, null, null, null, null, null));
    return issue.number();
  }

  @Test
  void replace_attaches_and_detaches_cycles() {
    Long owner = createUser("o");
    ProjectResponse p = newProject(owner, "IC");
    var c1 =
        cycleService.create(owner, p.key(), new CreateCycleRequest("S1", null, null, null, null));
    var c2 =
        cycleService.create(owner, p.key(), new CreateCycleRequest("S2", null, null, null, null));
    int number = newIssue(owner, p, "T1");

    var after = issueCycleService.replace(owner, p.key(), number, List.of(c1.id(), c2.id()));
    assertThat(after).extracting("id").containsExactlyInAnyOrder(c1.id(), c2.id());

    var afterRemove = issueCycleService.replace(owner, p.key(), number, List.of(c2.id()));
    assertThat(afterRemove).extracting("id").containsExactly(c2.id());
  }

  @Test
  void replace_with_cycle_from_other_project_throws_400() {
    Long owner = createUser("o2");
    ProjectResponse p1 = newProject(owner, "ID");
    ProjectResponse p2 = newProject(owner, "IE");
    var other =
        cycleService.create(owner, p2.key(), new CreateCycleRequest("X", null, null, null, null));
    int number = newIssue(owner, p1, "T");

    assertThatThrownBy(
            () -> issueCycleService.replace(owner, p1.key(), number, List.of(other.id())))
        .isInstanceOf(InvalidCycleForProjectException.class);
  }
}
