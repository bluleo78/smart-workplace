package com.workplace.issue.service;

import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.cycle.dto.CreateCycleRequest;
import com.workplace.cycle.service.CycleService;
import com.workplace.issue.dto.CreateIssueRequest;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.dto.ProjectResponse;
import com.workplace.project.service.ProjectService;
import com.workplace.support.IntegrationTestBase;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/** IssueSearchService cycle 필터 검증 — OR 시맨틱 (지정 사이클 중 하나라도 연결된 이슈만 매칭). */
@Transactional
class IssueSearchServiceCyclesTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired IssueSearchService searchService;
  @Autowired IssueCycleService issueCycleService;
  @Autowired CycleService cycleService;
  @Autowired IssueService issueService;
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

  private int newIssue(Long owner, ProjectResponse p, String title) {
    return issueService
        .create(
            owner, p.key(), new CreateIssueRequest(title, null, null, null, null, null, null, null))
        .number();
  }

  @Test
  void cycle_filter_returns_only_linked_issue() {
    Long owner = createUser("cy");
    ProjectResponse p = newProject(owner, "CYF");
    var cycle =
        cycleService.create(
            owner, p.key(), new CreateCycleRequest("Sprint 1", null, null, null, null));

    int linked = newIssue(owner, p, "linked-issue");
    int unlinked = newIssue(owner, p, "unlinked-issue");

    // linked 이슈만 사이클에 연결
    issueCycleService.replace(owner, p.key(), linked, List.of(cycle.id()));

    var resp = searchService.search(owner, p.key(), Map.of("cycle", String.valueOf(cycle.id())));

    assertThat(resp.items()).hasSize(1);
    assertThat(resp.items().get(0).number()).isEqualTo(linked);
  }

  @Test
  void no_cycle_filter_returns_all_issues() {
    Long owner = createUser("cy2");
    ProjectResponse p = newProject(owner, "CYG");
    var cycle =
        cycleService.create(
            owner, p.key(), new CreateCycleRequest("Sprint 2", null, null, null, null));

    newIssue(owner, p, "issue-a");
    int b = newIssue(owner, p, "issue-b");
    issueCycleService.replace(owner, p.key(), b, List.of(cycle.id()));

    var resp = searchService.search(owner, p.key(), Map.of());

    assertThat(resp.items()).hasSize(2);
  }

  @Test
  void cycle_filter_or_semantics_matches_either_cycle() {
    Long owner = createUser("cy3");
    ProjectResponse p = newProject(owner, "CYH");
    var c1 =
        cycleService.create(owner, p.key(), new CreateCycleRequest("S1", null, null, null, null));
    var c2 =
        cycleService.create(owner, p.key(), new CreateCycleRequest("S2", null, null, null, null));

    int i1 = newIssue(owner, p, "in-c1");
    int i2 = newIssue(owner, p, "in-c2");
    newIssue(owner, p, "in-none");

    issueCycleService.replace(owner, p.key(), i1, List.of(c1.id()));
    issueCycleService.replace(owner, p.key(), i2, List.of(c2.id()));

    // cycle=c1,c2 → i1, i2 모두 반환 (OR 시맨틱)
    var resp = searchService.search(owner, p.key(), Map.of("cycle", c1.id() + "," + c2.id()));

    assertThat(resp.items()).hasSize(2);
    assertThat(resp.items()).extracting("number").containsExactlyInAnyOrder(i1, i2);
  }
}
