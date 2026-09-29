package com.workplace.issue.service;

import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.cycle.dto.CreateCycleRequest;
import com.workplace.cycle.dto.CycleResponse;
import com.workplace.cycle.exception.CompletedCycleNotAssignableException;
import com.workplace.cycle.exception.InvalidCycleForProjectException;
import com.workplace.cycle.service.CycleService;
import com.workplace.issue.dto.CreateIssueRequest;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.dto.ProjectResponse;
import com.workplace.project.exception.ProjectAccessDeniedException;
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

  // 사이클 생성 헬퍼 — status null 이면 기본(PLANNED).
  private CycleResponse newCycle(Long owner, ProjectResponse p, String name, String status) {
    return cycleService.create(
        owner, p.key(), new CreateCycleRequest(name, null, null, null, status));
  }

  private CycleResponse newCycle(Long owner, ProjectResponse p, String name) {
    return newCycle(owner, p, name, null);
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

  // --- move (#881: 사이클 페이지 드래그 이동) ---

  @Test
  void move_between_cycles_detaches_source_and_keeps_other_links() {
    Long owner = createUser("mv");
    ProjectResponse p = newProject(owner, "MV");
    var a = newCycle(owner, p, "A");
    var b = newCycle(owner, p, "B");
    var other = newCycle(owner, p, "O");
    int number = newIssue(owner, p, "T");
    issueCycleService.replace(owner, p.key(), number, List.of(a.id(), other.id()));

    var after = issueCycleService.move(owner, p.key(), number, a.id(), b.id());

    // A 해제·B 추가, 드래그와 무관한 O 연결은 유지
    assertThat(after.cycles()).extracting("id").containsExactlyInAnyOrder(b.id(), other.id());
    assertThat(after.removedFrom()).isTrue();
    assertThat(after.addedTo()).isTrue();
  }

  @Test
  void move_to_backlog_detaches_only_source_and_from_backlog_attaches_target() {
    Long owner = createUser("mb");
    ProjectResponse p = newProject(owner, "MB");
    var a = newCycle(owner, p, "A");
    int number = newIssue(owner, p, "T");

    // 백로그 → A
    assertThat(issueCycleService.move(owner, p.key(), number, null, a.id()).cycles())
        .extracting("id")
        .containsExactly(a.id());
    // A → 백로그
    assertThat(issueCycleService.move(owner, p.key(), number, a.id(), null).cycles()).isEmpty();
  }

  @Test
  void move_is_idempotent_for_stale_source_and_existing_target() {
    Long owner = createUser("mi");
    ProjectResponse p = newProject(owner, "MI");
    var a = newCycle(owner, p, "A");
    var b = newCycle(owner, p, "B");
    int number = newIssue(owner, p, "T");
    issueCycleService.replace(owner, p.key(), number, List.of(b.id()));

    // from(A) 은 이미 끊겨 있고 to(B) 는 이미 연결 — 오류 없이 현 상태 유지
    assertThat(issueCycleService.move(owner, p.key(), number, a.id(), b.id()).cycles())
        .extracting("id")
        .containsExactly(b.id());
    // 같은 사이클로의 이동은 no-op
    assertThat(issueCycleService.move(owner, p.key(), number, b.id(), b.id()).cycles())
        .extracting("id")
        .containsExactly(b.id());
  }

  @Test
  void move_into_completed_cycle_throws_400_and_keeps_links() {
    Long owner = createUser("mc");
    ProjectResponse p = newProject(owner, "MC");
    var a = newCycle(owner, p, "A");
    var done = newCycle(owner, p, "D", "COMPLETED");
    int number = newIssue(owner, p, "T");
    issueCycleService.replace(owner, p.key(), number, List.of(a.id()));

    assertThatThrownBy(() -> issueCycleService.move(owner, p.key(), number, a.id(), done.id()))
        .isInstanceOf(CompletedCycleNotAssignableException.class);
    assertThat(issueCycleService.list(owner, p.key(), number))
        .extracting("id")
        .containsExactly(a.id());
  }

  @Test
  void move_out_of_completed_cycle_is_allowed() {
    Long owner = createUser("mo");
    ProjectResponse p = newProject(owner, "MO");
    var done = newCycle(owner, p, "D", "COMPLETED");
    int number = newIssue(owner, p, "T");
    issueCycleService.replace(owner, p.key(), number, List.of(done.id()));

    assertThat(issueCycleService.move(owner, p.key(), number, done.id(), null).cycles()).isEmpty();
  }

  @Test
  void move_into_other_project_cycle_throws_400() {
    Long owner = createUser("mx");
    ProjectResponse p1 = newProject(owner, "MX");
    ProjectResponse p2 = newProject(owner, "MY");
    var foreign = newCycle(owner, p2, "X");
    int number = newIssue(owner, p1, "T");

    assertThatThrownBy(() -> issueCycleService.move(owner, p1.key(), number, null, foreign.id()))
        .isInstanceOf(InvalidCycleForProjectException.class);
  }

  @Test
  void move_by_non_member_is_denied() {
    Long owner = createUser("mn");
    Long outsider = createUser("out");
    ProjectResponse p = newProject(owner, "MN");
    var a = newCycle(owner, p, "A");
    int number = newIssue(owner, p, "T");

    assertThatThrownBy(() -> issueCycleService.move(outsider, p.key(), number, null, a.id()))
        .isInstanceOf(ProjectAccessDeniedException.class);
  }

  @Test
  void move_reports_effective_diff_so_reverse_diff_restores_shared_issue() {
    Long owner = createUser("md");
    ProjectResponse p = newProject(owner, "MD");
    var a = newCycle(owner, p, "A");
    var b = newCycle(owner, p, "B");
    int number = newIssue(owner, p, "T");
    // 두 사이클에 걸친 이슈 — A 섹션 행을 B 섹션으로 끈다.
    issueCycleService.replace(owner, p.key(), number, List.of(a.id(), b.id()));

    var moved = issueCycleService.move(owner, p.key(), number, a.id(), b.id());
    assertThat(moved.cycles()).extracting("id").containsExactly(b.id());
    // B 는 이미 붙어 있어 추가하지 않았다 — 되돌리기는 A 재연결만 해야 한다.
    assertThat(moved.removedFrom()).isTrue();
    assertThat(moved.addedTo()).isFalse();

    // 클라이언트 규칙: from = addedTo ? to : null, to = removedFrom ? from : null
    var undone = issueCycleService.move(owner, p.key(), number, null, a.id());
    assertThat(undone.cycles()).extracting("id").containsExactlyInAnyOrder(a.id(), b.id());
  }
}
