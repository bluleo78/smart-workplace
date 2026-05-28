package com.workplace.issue.repository;

import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.global.dto.UserSummary;
import com.workplace.issue.dto.IssueRow;
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

/** IssueAssigneeRepository 통합 테스트 — add/remove/find/batch. */
@Transactional
class IssueAssigneeRepositoryTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired IssueAssigneeRepository repo;
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
    return (prefix + suffix).substring(0, Math.min(10, (prefix + suffix).length()));
  }

  private ProjectResponse newProject(Long ownerId, String prefix) {
    return projectService.create(
        ownerId, new CreateProjectRequest(uniqueKey(prefix), "P-" + prefix, "x"));
  }

  @Test
  void add_and_find_by_issue_returns_user_summaries() {
    Long owner = createUser("a");
    Long u1 = createUser("alpha");
    Long u2 = createUser("bravo");
    ProjectResponse p = newProject(owner, "IA1");
    IssueRow issue = issueRepository.insert(p.id(), 1, "t", null, "MID", null, owner);

    repo.add(issue.id(), u1, owner);
    repo.add(issue.id(), u2, owner);

    var result = repo.findByIssue(issue.id());
    assertThat(result).hasSize(2);
    assertThat(result).extracting(UserSummary::id).containsExactlyInAnyOrder(u1, u2);
  }

  @Test
  void find_by_issue_ids_batch_returns_grouped_map() {
    Long owner = createUser("b");
    Long u1 = createUser("c1");
    Long u2 = createUser("c2");
    ProjectResponse p = newProject(owner, "IA2");
    IssueRow i1 = issueRepository.insert(p.id(), 1, "t1", null, "MID", null, owner);
    IssueRow i2 = issueRepository.insert(p.id(), 2, "t2", null, "MID", null, owner);

    repo.add(i1.id(), u1, owner);
    repo.add(i1.id(), u2, owner);
    repo.add(i2.id(), u1, owner);

    var map = repo.findByIssueIds(List.of(i1.id(), i2.id()));
    assertThat(map.get(i1.id())).hasSize(2);
    assertThat(map.get(i2.id())).hasSize(1);
  }

  @Test
  void remove_drops_one_row() {
    Long owner = createUser("c");
    Long u1 = createUser("d1");
    ProjectResponse p = newProject(owner, "IA3");
    IssueRow issue = issueRepository.insert(p.id(), 1, "t", null, "MID", null, owner);
    repo.add(issue.id(), u1, owner);
    assertThat(repo.findUserIdsByIssue(issue.id())).contains(u1);

    repo.remove(issue.id(), u1);

    assertThat(repo.findUserIdsByIssue(issue.id())).doesNotContain(u1);
  }
}
