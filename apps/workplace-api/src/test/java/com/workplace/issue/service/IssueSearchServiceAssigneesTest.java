package com.workplace.issue.service;

import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.issue.dto.IssueResponse;
import com.workplace.issue.repository.IssueAssigneeRepository;
import com.workplace.issue.repository.IssueRepository;
import com.workplace.project.dto.AddMemberRequest;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.dto.ProjectResponse;
import com.workplace.project.service.ProjectService;
import com.workplace.support.IntegrationTestBase;
import java.util.Map;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/** IssueSearchService 의 assignees N+1 batch + assignee CSV 필터 검증. */
@Transactional
class IssueSearchServiceAssigneesTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired IssueSearchService searchService;
  @Autowired IssueRepository issueRepository;
  @Autowired IssueAssigneeRepository assigneeRepository;
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
  void search_result_includes_assignees() {
    Long owner = createUser("g");
    Long u1 = createUser("g1");
    Long u2 = createUser("g2");
    ProjectResponse p = newProject(owner, "SA1");
    projectService.addMember(owner, p.key(), new AddMemberRequest(u1, "MEMBER"));
    projectService.addMember(owner, p.key(), new AddMemberRequest(u2, "MEMBER"));
    var i1 = issueRepository.insert(p.id(), 1, "with-assignees", null, "MID", null, owner);
    issueRepository.insert(p.id(), 2, "without", null, "MID", null, owner);
    assigneeRepository.add(i1.id(), u1, owner);
    assigneeRepository.add(i1.id(), u2, owner);

    var resp = searchService.search(owner, p.key(), Map.of());

    IssueResponse withA =
        resp.items().stream().filter(x -> x.number() == 1).findFirst().orElseThrow();
    IssueResponse without =
        resp.items().stream().filter(x -> x.number() == 2).findFirst().orElseThrow();
    assertThat(withA.assignees()).hasSize(2);
    assertThat(without.assignees()).isEmpty();
  }

  @Test
  void filter_assignee_csv_or_matches_unassigned_via_subquery() {
    Long owner = createUser("h");
    Long u1 = createUser("h1");
    Long u2 = createUser("h2");
    ProjectResponse p = newProject(owner, "SA2");
    projectService.addMember(owner, p.key(), new AddMemberRequest(u1, "MEMBER"));
    projectService.addMember(owner, p.key(), new AddMemberRequest(u2, "MEMBER"));
    var i1 = issueRepository.insert(p.id(), 1, "u1-only", null, "MID", null, owner);
    var i2 = issueRepository.insert(p.id(), 2, "u2-only", null, "MID", null, owner);
    issueRepository.insert(p.id(), 3, "none", null, "MID", null, owner);
    assigneeRepository.add(i1.id(), u1, owner);
    assigneeRepository.add(i2.id(), u2, owner);

    // user1 + null → user1 이슈 + 미지정 이슈 매칭, user2 이슈는 제외
    var resp = searchService.search(owner, p.key(), Map.of("assignee", u1 + ",null"));

    assertThat(resp.items())
        .extracting(IssueResponse::title)
        .containsExactlyInAnyOrder("u1-only", "none");
  }
}
