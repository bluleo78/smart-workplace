package com.workplace.issue.service;

import static com.workplace.jooq.Tables.ISSUE;
import static com.workplace.jooq.Tables.MEMBERSHIP;
import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.issue.dto.IssueGroupCountsResponse.GroupCount;
import com.workplace.issue.exception.InvalidCursorException;
import com.workplace.issue.repository.IssueAssigneeRepository;
import com.workplace.issue.repository.IssueRepository;
import com.workplace.issue.support.IssueSeeds;
import com.workplace.project.dto.AddMemberRequest;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.dto.ProjectResponse;
import com.workplace.project.service.ProjectService;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/**
 * WP-472 — 목록 그룹별 총계. 검색과 같은 필터로 센 정확한 수여야 한다(화면이 센 수는 30개씩 불러온 행 수라 헤더가 틀렸다). 페이지 크기와 상관없이 전체를 세고,
 * 필터를 그대로 따르고, 담당자 여럿이면 각자에 한 번씩·담당자 없음은 null 키로 센다.
 */
@Transactional
class IssueSearchServiceGroupCountsTest extends IntegrationTestBase {

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
    // 테넌트#1 ACTIVE 멤버십 — MembershipGuard(#713) 가 addMember 대상의 테넌트 소속을 검증하므로 필요.
    dsl.insertInto(MEMBERSHIP)
        .set(MEMBERSHIP.USER_ID, id)
        .set(MEMBERSHIP.TENANT_ID, 1L)
        .set(MEMBERSHIP.STATUS, "ACTIVE")
        .execute();
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

  private void setStatus(Long issueId, String status) {
    dsl.update(ISSUE)
        .set(ISSUE.STATUS, status)
        .set(ISSUE.STATUS_ID, TestFixtures.defaultStatusId(ISSUE.PROJECT_ID, status))
        .where(ISSUE.ID.eq(issueId))
        .execute();
  }

  @Test
  void status_counts_cover_all_rows_not_just_one_page() {
    Long owner = createUser("gc");
    ProjectResponse p = newProject(owner, "GC1");
    // 35건 — 한 페이지(30)보다 많다. TODO 32 · DONE 3
    for (int n = 1; n <= 35; n++) {
      var row =
          IssueSeeds.insert(issueRepository, baseDsl, p.id(), n, "i" + n, null, "MID", null, owner);
      if (n > 32) setStatus(row.id(), "DONE");
    }

    var resp = searchService.groupCounts(owner, p.key(), Map.of("groupBy", "status", "size", "30"));

    assertThat(resp.groups())
        .containsExactlyInAnyOrder(new GroupCount("TODO", 32), new GroupCount("DONE", 3));
  }

  @Test
  void counts_follow_the_same_filters_as_search() {
    Long owner = createUser("gf");
    ProjectResponse p = newProject(owner, "GC2");
    IssueSeeds.insert(issueRepository, baseDsl, p.id(), 1, "alpha one", null, "HIGH", null, owner);
    IssueSeeds.insert(issueRepository, baseDsl, p.id(), 2, "alpha two", null, "LOW", null, owner);
    IssueSeeds.insert(issueRepository, baseDsl, p.id(), 3, "beta", null, "HIGH", null, owner);

    var resp =
        searchService.groupCounts(owner, p.key(), Map.of("groupBy", "priority", "q", "alpha"));

    assertThat(resp.groups())
        .containsExactlyInAnyOrder(new GroupCount("HIGH", 1), new GroupCount("LOW", 1));
    // 목록과 같은 조건 — 검색 결과 수와 총계 합이 같다.
    assertThat(searchService.search(owner, p.key(), Map.of("q", "alpha")).items()).hasSize(2);
  }

  @Test
  void assignee_counts_each_assignee_and_unassigned_as_null_key() {
    Long owner = createUser("ga");
    Long u1 = createUser("ga1");
    Long u2 = createUser("ga2");
    ProjectResponse p = newProject(owner, "GC3");
    projectService.addMember(owner, p.key(), new AddMemberRequest(u1, "MEMBER"));
    projectService.addMember(owner, p.key(), new AddMemberRequest(u2, "MEMBER"));
    var both =
        IssueSeeds.insert(issueRepository, baseDsl, p.id(), 1, "both", null, "MID", null, owner);
    var only1 =
        IssueSeeds.insert(issueRepository, baseDsl, p.id(), 2, "only1", null, "MID", null, owner);
    IssueSeeds.insert(issueRepository, baseDsl, p.id(), 3, "none-a", null, "MID", null, owner);
    IssueSeeds.insert(issueRepository, baseDsl, p.id(), 4, "none-b", null, "MID", null, owner);
    assigneeRepository.add(both.id(), u1, owner);
    assigneeRepository.add(both.id(), u2, owner);
    assigneeRepository.add(only1.id(), u1, owner);

    var resp = searchService.groupCounts(owner, p.key(), Map.of("groupBy", "assignee"));

    assertThat(resp.groups())
        .containsExactlyInAnyOrder(
            new GroupCount(String.valueOf(u1), 2),
            new GroupCount(String.valueOf(u2), 1),
            new GroupCount(null, 2));
  }

  @Test
  void unsupported_group_by_is_rejected() {
    Long owner = createUser("gx");
    ProjectResponse p = newProject(owner, "GC4");
    for (var g : List.of("epic", "cycle", "")) {
      assertThatThrownBy(() -> searchService.groupCounts(owner, p.key(), Map.of("groupBy", g)))
          .isInstanceOf(InvalidCursorException.class);
    }
  }
}
