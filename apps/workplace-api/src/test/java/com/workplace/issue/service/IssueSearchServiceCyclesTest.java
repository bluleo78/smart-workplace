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

/**
 * IssueSearchService cycle 필터 검증 — OR 시맨틱 (지정 사이클 중 하나라도 연결된 이슈만 매칭) + cycle=null 백로그 토큰(#878). 백로그
 * = 진행 중(ACTIVE)·예정(PLANNED) 사이클에 연결되지 않은 이슈 — 완료 사이클에만 남은 이슈는 백로그로 돌아온다.
 */
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

  // ── #878: cycle=null 토큰 — 백로그(진행 중·예정 사이클에 연결되지 않은 이슈) ──

  @Test
  void cycle_null_alone_excludes_open_cycle_issue_and_no_number_format_error() {
    Long owner = createUser("cyn");
    ProjectResponse p = newProject(owner, "CYN");
    var c1 =
        cycleService.create(owner, p.key(), new CreateCycleRequest("S1", null, null, null, null));

    int linked = newIssue(owner, p, "linked");
    int unlinked = newIssue(owner, p, "unlinked");
    issueCycleService.replace(owner, p.key(), linked, List.of(c1.id()));

    // 'null' 토큰이 NumberFormatException 으로 버려지면 필터 미적용(전체 2건)이 되므로 1건이어야 한다. 대소문자 무시.
    var resp = searchService.search(owner, p.key(), Map.of("cycle", "NULL"));

    assertThat(resp.items()).extracting("number").containsExactly(unlinked);
  }

  @Test
  void cycle_null_combined_with_id_is_or() {
    Long owner = createUser("cyo");
    ProjectResponse p = newProject(owner, "CYO");
    var c1 =
        cycleService.create(owner, p.key(), new CreateCycleRequest("S1", null, null, null, null));
    var c2 =
        cycleService.create(owner, p.key(), new CreateCycleRequest("S2", null, null, null, null));

    int inC1 = newIssue(owner, p, "in-c1");
    int inC2 = newIssue(owner, p, "in-c2");
    int none = newIssue(owner, p, "in-none");
    issueCycleService.replace(owner, p.key(), inC1, List.of(c1.id()));
    issueCycleService.replace(owner, p.key(), inC2, List.of(c2.id()));

    // cycle=null,c1 → 백로그 OR 사이클1 (예정 사이클2 전용 이슈는 제외)
    var resp = searchService.search(owner, p.key(), Map.of("cycle", "null," + c1.id()));

    assertThat(resp.items()).extracting("number").containsExactlyInAnyOrder(inC1, none);
  }

  @Test
  void cycle_null_includes_completed_only_and_excludes_open_cycle_links() {
    Long owner = createUser("cym");
    ProjectResponse p = newProject(owner, "CYM");
    var active =
        cycleService.create(
            owner, p.key(), new CreateCycleRequest("Active", null, null, null, "ACTIVE"));
    var planned =
        cycleService.create(owner, p.key(), new CreateCycleRequest("Plan", null, null, null, null));
    var completed =
        cycleService.create(
            owner, p.key(), new CreateCycleRequest("Done", null, null, null, "COMPLETED"));

    int multi = newIssue(owner, p, "multi");
    int activeOnly = newIssue(owner, p, "active-only");
    int plannedOnly = newIssue(owner, p, "planned-only");
    int completedOnly = newIssue(owner, p, "completed-only");
    int completedAndActive = newIssue(owner, p, "completed-and-active");
    int none = newIssue(owner, p, "none");
    // M:N — 진행 중·예정 동시 연결
    issueCycleService.replace(owner, p.key(), multi, List.of(active.id(), planned.id()));
    issueCycleService.replace(owner, p.key(), activeOnly, List.of(active.id()));
    issueCycleService.replace(owner, p.key(), plannedOnly, List.of(planned.id()));
    // 완료 사이클에만 연결 — 끝난 스프린트의 이슈는 백로그로 돌아온다
    issueCycleService.replace(owner, p.key(), completedOnly, List.of(completed.id()));
    // 완료 + 진행 중 동시 연결 — 열린 사이클에 있으므로 백로그가 아니다
    issueCycleService.replace(
        owner, p.key(), completedAndActive, List.of(completed.id(), active.id()));

    var resp = searchService.search(owner, p.key(), Map.of("cycle", "null"));

    assertThat(resp.items()).extracting("number").containsExactlyInAnyOrder(none, completedOnly);
    assertThat(resp.items())
        .extracting("number")
        .doesNotContain(multi, activeOnly, plannedOnly, completedAndActive);
  }

  @Test
  void cycle_null_is_consistent_between_project_search_and_cross_project_search_mine() {
    Long owner = createUser("cyx");
    ProjectResponse p = newProject(owner, "CYX");
    var c1 =
        cycleService.create(owner, p.key(), new CreateCycleRequest("S1", null, null, null, null));

    var done =
        cycleService.create(
            owner, p.key(), new CreateCycleRequest("Done", null, null, null, "COMPLETED"));

    int linked = newIssue(owner, p, "linked");
    int unlinked = newIssue(owner, p, "unlinked");
    int completedOnly = newIssue(owner, p, "completed-only");
    issueCycleService.replace(owner, p.key(), linked, List.of(c1.id()));
    issueCycleService.replace(owner, p.key(), completedOnly, List.of(done.id()));

    // 프로젝트 검색(search)과 횡단 검색(searchMemberOf) 두 술어 경로가 같은 결과를 내야 한다.
    var project = searchService.search(owner, p.key(), Map.of("cycle", "null"));
    var mine = searchService.searchMine(owner, Map.of("cycle", "null"));
    var mineOr = searchService.searchMine(owner, Map.of("cycle", "null," + c1.id()));

    assertThat(project.items())
        .extracting("number")
        .containsExactlyInAnyOrder(unlinked, completedOnly);
    assertThat(mine.items())
        .extracting("number")
        .containsExactlyInAnyOrder(unlinked, completedOnly);
    assertThat(mineOr.items())
        .extracting("number")
        .containsExactlyInAnyOrder(linked, unlinked, completedOnly);
  }

  // ── WP-176: cycle=none 토큰 — 사이클 연결이 하나도 없는 이슈(백로그와 달리 완료 사이클 연결 이슈 제외) ──

  @Test
  void cycle_none_matches_only_issues_without_any_cycle_link() {
    Long owner = createUser("cyz");
    ProjectResponse p = newProject(owner, "CYZ");
    var active =
        cycleService.create(
            owner, p.key(), new CreateCycleRequest("Active", null, null, null, "ACTIVE"));
    var completed =
        cycleService.create(
            owner, p.key(), new CreateCycleRequest("Done", null, null, null, "COMPLETED"));

    int activeOnly = newIssue(owner, p, "active-only");
    int completedOnly = newIssue(owner, p, "completed-only");
    int none = newIssue(owner, p, "none");
    issueCycleService.replace(owner, p.key(), activeOnly, List.of(active.id()));
    issueCycleService.replace(owner, p.key(), completedOnly, List.of(completed.id()));

    // 완료 사이클에만 연결된 이슈는 백로그(null)에는 들어가지만 none 에는 들어가지 않는다. 대소문자 무시.
    var resp = searchService.search(owner, p.key(), Map.of("cycle", "NONE"));
    var mine = searchService.searchMine(owner, Map.of("cycle", "none"));

    assertThat(resp.items()).extracting("number").containsExactly(none);
    assertThat(mine.items()).extracting("number").containsExactly(none);
  }

  @Test
  void cycle_none_combined_with_id_is_or() {
    Long owner = createUser("cyw");
    ProjectResponse p = newProject(owner, "CYW");
    var c1 =
        cycleService.create(owner, p.key(), new CreateCycleRequest("S1", null, null, null, null));
    var c2 =
        cycleService.create(owner, p.key(), new CreateCycleRequest("S2", null, null, null, null));

    int inC1 = newIssue(owner, p, "in-c1");
    int inC2 = newIssue(owner, p, "in-c2");
    int none = newIssue(owner, p, "none");
    issueCycleService.replace(owner, p.key(), inC1, List.of(c1.id()));
    issueCycleService.replace(owner, p.key(), inC2, List.of(c2.id()));

    var resp = searchService.search(owner, p.key(), Map.of("cycle", "none," + c1.id()));

    assertThat(resp.items()).extracting("number").containsExactlyInAnyOrder(inC1, none);
  }
}
