package com.workplace.issue.service;

import static com.workplace.jooq.Tables.CYCLE;
import static com.workplace.jooq.Tables.ISSUE;
import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.issue.dto.CreateIssueRequest;
import com.workplace.issue.dto.IssueResponse;
import com.workplace.issue.repository.IssueCycleRepository;
import com.workplace.issue.repository.IssueRepository;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.dto.ProjectResponse;
import com.workplace.project.service.ProjectService;
import com.workplace.support.IntegrationTestBase;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/** #876 — hideInactiveClosed: 종료(DONE·CANCELED) 이슈는 ACTIVE 사이클 연결분만 남기고 나머지는 숨긴다. */
@Transactional
class IssueSearchServiceClosedScopeTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired IssueService issueService;
  @Autowired IssueSearchService searchService;
  @Autowired ProjectService projectService;
  @Autowired IssueRepository issueRepository;
  @Autowired IssueCycleRepository issueCycleRepository;

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

  private ProjectResponse newProject(Long ownerId) {
    String suffix = UUID.randomUUID().toString().replaceAll("-", "").toUpperCase().substring(0, 4);
    return projectService.create(
        ownerId, new CreateProjectRequest("HC" + suffix, "P-HC" + suffix, "x"));
  }

  /** 이슈를 만들고 상태를 직접 지정한다(상태 전이 검증은 이 테스트의 관심사가 아니다). */
  private int issue(Long owner, ProjectResponse p, String title, String status) {
    var created =
        issueService.create(
            owner,
            p.key(),
            new CreateIssueRequest(title, null, null, null, null, null, null, null));
    dsl.update(ISSUE).set(ISSUE.STATUS, status).where(ISSUE.ID.eq(created.id())).execute();
    return created.number();
  }

  private Long cycle(ProjectResponse p, String name, String status) {
    return dsl.insertInto(CYCLE)
        .set(CYCLE.PROJECT_ID, p.id())
        .set(CYCLE.NAME, name)
        .set(CYCLE.STATUS, status)
        .returning(CYCLE.ID)
        .fetchOne()
        .getId();
  }

  private void link(ProjectResponse p, int number, Long cycleId) {
    issueCycleRepository.add(
        issueRepository.findByProjectAndNumber(p.id(), number).orElseThrow().id(), cycleId);
  }

  private List<Integer> numbers(Long owner, ProjectResponse p, Map<String, String> params) {
    return searchService.search(owner, p.key(), new HashMap<>(params)).items().stream()
        .map(IssueResponse::number)
        .toList();
  }

  @Test
  void hides_closed_issues_outside_active_cycle() {
    Long owner = createUser("hc");
    var p = newProject(owner);
    Long active = cycle(p, "active", "ACTIVE");
    Long planned = cycle(p, "planned", "PLANNED");
    Long completed = cycle(p, "completed", "COMPLETED");

    int todo = issue(owner, p, "todo", "TODO");
    int doing = issue(owner, p, "doing", "IN_PROGRESS");
    int doneNoCycle = issue(owner, p, "done-none", "DONE");
    int canceledNoCycle = issue(owner, p, "canceled-none", "CANCELED");
    int doneActive = issue(owner, p, "done-active", "DONE");
    int canceledActive = issue(owner, p, "canceled-active", "CANCELED");
    int donePlanned = issue(owner, p, "done-planned", "DONE");
    int doneCompleted = issue(owner, p, "done-completed", "DONE");
    // 과거 사이클과 활성 사이클에 동시에 걸린 완료 이슈 — 활성 연결이 하나라도 있으면 남는다.
    int doneBoth = issue(owner, p, "done-both", "DONE");
    link(p, doneActive, active);
    link(p, canceledActive, active);
    link(p, donePlanned, planned);
    link(p, doneCompleted, completed);
    link(p, doneBoth, completed);
    link(p, doneBoth, active);

    assertThat(numbers(owner, p, Map.of("hideInactiveClosed", "true")))
        .containsExactlyInAnyOrder(todo, doing, doneActive, canceledActive, doneBoth);
    // 파라미터가 없으면 기존처럼 전부 노출된다.
    assertThat(numbers(owner, p, Map.of()))
        .containsExactlyInAnyOrder(
            todo,
            doing,
            doneNoCycle,
            canceledNoCycle,
            doneActive,
            canceledActive,
            donePlanned,
            doneCompleted,
            doneBoth);
  }

  @Test
  void combines_with_status_filter() {
    Long owner = createUser("hc");
    var p = newProject(owner);
    Long active = cycle(p, "active", "ACTIVE");
    issue(owner, p, "todo", "TODO");
    issue(owner, p, "done-none", "DONE");
    int doneActive = issue(owner, p, "done-active", "DONE");
    link(p, doneActive, active);

    assertThat(numbers(owner, p, Map.of("hideInactiveClosed", "true", "status", "DONE")))
        .containsExactly(doneActive);
  }
}
