package com.workplace.issue.service;

import static com.workplace.jooq.Tables.ISSUE;
import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static com.workplace.support.TestFixtures.uniqueProjectKey;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.cycle.dto.CreateCycleRequest;
import com.workplace.cycle.dto.CycleCompleteRequest;
import com.workplace.cycle.dto.CycleResponse;
import com.workplace.cycle.exception.CompletedCycleNotAssignableException;
import com.workplace.cycle.exception.InvalidCycleForProjectException;
import com.workplace.cycle.service.CycleService;
import com.workplace.issue.dto.CreateIssueRequest;
import com.workplace.issue.support.IssueSeeds;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.dto.ProjectResponse;
import com.workplace.project.exception.ProjectNotFoundException;
import com.workplace.project.service.ProjectService;
import com.workplace.support.IntegrationTestBase;
import java.time.LocalDate;
import java.time.OffsetDateTime;
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
    return uniqueProjectKey(prefix);
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

  // 사이클을 완료로 바꾸는 헬퍼 — 완료 사이클엔 새로 붙일 수 없어(WP-659) 붙인 뒤 완료한다.
  private void complete(Long owner, ProjectResponse p, CycleResponse c) {
    cycleService.update(
        owner, p.key(), c.id(), new CreateCycleRequest(c.name(), null, null, null, "COMPLETED"));
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
  void replace_duplicateIds_stillValid() {
    Long owner = createUser("od");
    ProjectResponse p = newProject(owner, "IF");
    var c1 = newCycle(owner, p, "D1");
    int number = newIssue(owner, p, "T");

    var after = issueCycleService.replace(owner, p.key(), number, List.of(c1.id(), c1.id()));
    assertThat(after).extracting("id").containsExactly(c1.id());
  }

  @Test
  void replace_emptyOrNull_detachesAll() {
    Long owner = createUser("oe");
    ProjectResponse p = newProject(owner, "IG");
    var c1 = newCycle(owner, p, "E1");
    int number = newIssue(owner, p, "T");
    issueCycleService.replace(owner, p.key(), number, List.of(c1.id()));

    assertThat(issueCycleService.replace(owner, p.key(), number, List.of())).isEmpty();
    issueCycleService.replace(owner, p.key(), number, List.of(c1.id()));
    assertThat(issueCycleService.replace(owner, p.key(), number, null)).isEmpty();
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

  // --- WP-659: 집합 교체(이슈 상세 사이클 피커)도 완료 사이클에 새로 붙이지 못한다(move 와 같은 규칙) ---

  @Test
  void replace_adding_completed_cycle_throws_400_and_keeps_links() {
    Long owner = createUser("rc");
    ProjectResponse p = newProject(owner, "RC");
    var a = newCycle(owner, p, "A");
    var done = newCycle(owner, p, "D", "COMPLETED");
    int number = newIssue(owner, p, "T");
    issueCycleService.replace(owner, p.key(), number, List.of(a.id()));

    assertThatThrownBy(
            () -> issueCycleService.replace(owner, p.key(), number, List.of(a.id(), done.id())))
        .isInstanceOf(CompletedCycleNotAssignableException.class);
    assertThat(issueCycleService.list(owner, p.key(), number))
        .extracting("id")
        .containsExactly(a.id());
  }

  @Test
  void replace_keeps_or_detaches_already_linked_completed_cycle() {
    Long owner = createUser("rk");
    ProjectResponse p = newProject(owner, "RK");
    var done = newCycle(owner, p, "D");
    var b = newCycle(owner, p, "B");
    int number = newIssue(owner, p, "T");
    issueCycleService.replace(owner, p.key(), number, List.of(done.id()));
    complete(owner, p, done);

    // 이미 붙은 완료 사이클은 그대로 둔 채 다른 사이클을 더할 수 있다.
    assertThat(issueCycleService.replace(owner, p.key(), number, List.of(done.id(), b.id())))
        .extracting("id")
        .containsExactlyInAnyOrder(done.id(), b.id());
    // 떼기도 된다.
    assertThat(issueCycleService.replace(owner, p.key(), number, List.of(b.id())))
        .extracting("id")
        .containsExactly(b.id());
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
    var done = newCycle(owner, p, "D");
    int number = newIssue(owner, p, "T");
    issueCycleService.replace(owner, p.key(), number, List.of(done.id()));
    complete(owner, p, done);

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
        .isInstanceOf(ProjectNotFoundException.class);
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

  // --- WP-1932: 사이클 변경도 이슈 수정 시각을 올린다(version 은 그대로) ---

  /** 번호로 이슈 행 id 를 읽는다 — 수정 시각·version 직접 조회용. */
  private Long issueId(ProjectResponse p, int number) {
    return dsl.select(ISSUE.ID)
        .from(ISSUE)
        .where(ISSUE.PROJECT_ID.eq(p.id()).and(ISSUE.NUMBER.eq(number)))
        .fetchOne(ISSUE.ID);
  }

  /** 사이클 교체로 연결이 바뀌면 수정 시각은 올라가고 version 은 그대로다. */
  @Test
  void cycle_replace_bumps_updated_at_but_not_version() {
    Long owner = createUser("tu1");
    ProjectResponse p = newProject(owner, "TU1");
    var c = newCycle(owner, p, "A");
    int number = newIssue(owner, p, "T");
    Long id = issueId(p, number);
    OffsetDateTime before = IssueSeeds.rewindUpdatedAt(dsl, id);
    Integer versionBefore = IssueSeeds.version(dsl, id);

    issueCycleService.replace(owner, p.key(), number, List.of(c.id()));

    assertThat(IssueSeeds.updatedAt(dsl, id)).isAfter(before);
    assertThat(IssueSeeds.version(dsl, id)).isEqualTo(versionBefore);
  }

  /** 사이클에서 백로그로 옮기기(떼기만)도 수정 시각을 올린다. */
  @Test
  void cycle_move_remove_only_bumps_updated_at() {
    Long owner = createUser("tu2");
    ProjectResponse p = newProject(owner, "TU2");
    var a = newCycle(owner, p, "A");
    int number = newIssue(owner, p, "T");
    issueCycleService.replace(owner, p.key(), number, List.of(a.id()));
    Long id = issueId(p, number);
    OffsetDateTime before = IssueSeeds.rewindUpdatedAt(dsl, id);
    Integer versionBefore = IssueSeeds.version(dsl, id);

    // A → 백로그: 끊기만 하는 이동
    issueCycleService.move(owner, p.key(), number, a.id(), null);

    assertThat(IssueSeeds.updatedAt(dsl, id)).isAfter(before);
    assertThat(IssueSeeds.version(dsl, id)).isEqualTo(versionBefore);
  }

  /** 백로그에서 사이클로 옮기기(붙이기만)도 수정 시각을 올리고 version 은 그대로다(WP-1932 리뷰 후속). */
  @Test
  void cycle_move_add_only_bumps_updated_at() {
    Long owner = createUser("tu5");
    ProjectResponse p = newProject(owner, "TU5");
    var a = newCycle(owner, p, "A");
    int number = newIssue(owner, p, "T");
    Long id = issueId(p, number);
    OffsetDateTime before = IssueSeeds.rewindUpdatedAt(dsl, id);
    Integer versionBefore = IssueSeeds.version(dsl, id);

    // 백로그 → A: 붙이기만 하는 이동
    var result = issueCycleService.move(owner, p.key(), number, null, a.id());

    assertThat(result.addedTo()).isTrue();
    assertThat(IssueSeeds.updatedAt(dsl, id)).isAfter(before);
    assertThat(IssueSeeds.version(dsl, id)).isEqualTo(versionBefore);
  }

  /** 사이클 A 에서 B 로 옮기기(떼고 붙이기)도 수정 시각을 올리고 version 은 그대로다(WP-1932 리뷰 후속). */
  @Test
  void cycle_move_between_cycles_bumps_updated_at() {
    Long owner = createUser("tu6");
    ProjectResponse p = newProject(owner, "TU6");
    var a = newCycle(owner, p, "A");
    var b = newCycle(owner, p, "B");
    int number = newIssue(owner, p, "T");
    issueCycleService.replace(owner, p.key(), number, List.of(a.id()));
    Long id = issueId(p, number);
    OffsetDateTime before = IssueSeeds.rewindUpdatedAt(dsl, id);
    Integer versionBefore = IssueSeeds.version(dsl, id);

    var result = issueCycleService.move(owner, p.key(), number, a.id(), b.id());

    assertThat(result.removedFrom()).isTrue();
    assertThat(result.addedTo()).isTrue();
    assertThat(IssueSeeds.updatedAt(dsl, id)).isAfter(before);
    assertThat(IssueSeeds.version(dsl, id)).isEqualTo(versionBefore);
  }

  /** 같은 사이클로 옮기기(변화 없음)는 수정 시각을 올리지 않는다(WP-1932 리뷰 후속). */
  @Test
  void noop_cycle_move_keeps_updated_at() {
    Long owner = createUser("tu7");
    ProjectResponse p = newProject(owner, "TU7");
    var a = newCycle(owner, p, "A");
    int number = newIssue(owner, p, "T");
    issueCycleService.replace(owner, p.key(), number, List.of(a.id()));
    Long id = issueId(p, number);
    OffsetDateTime before = IssueSeeds.rewindUpdatedAt(dsl, id);

    var result = issueCycleService.move(owner, p.key(), number, a.id(), a.id());

    assertThat(result.removedFrom()).isFalse();
    assertThat(result.addedTo()).isFalse();
    assertThat(IssueSeeds.updatedAt(dsl, id)).isEqualTo(before);
  }

  /** 같은 사이클 집합으로 교체(diff 0)하면 수정 시각을 올리지 않는다. */
  @Test
  void noop_cycle_replace_keeps_updated_at() {
    Long owner = createUser("tu3");
    ProjectResponse p = newProject(owner, "TU3");
    var c = newCycle(owner, p, "A");
    int number = newIssue(owner, p, "T");
    issueCycleService.replace(owner, p.key(), number, List.of(c.id()));
    Long id = issueId(p, number);
    OffsetDateTime before = IssueSeeds.rewindUpdatedAt(dsl, id);

    issueCycleService.replace(owner, p.key(), number, List.of(c.id()));

    assertThat(IssueSeeds.updatedAt(dsl, id)).isEqualTo(before);
  }

  /** 사이클 완료의 미완료 이슈 일괄 이동은 일괄 부수 효과라 수정 시각을 올리지 않는다. */
  @Test
  void cycle_complete_attach_incomplete_keeps_updated_at() {
    Long owner = createUser("tu4");
    ProjectResponse p = newProject(owner, "TU4");
    var active = newCycle(owner, p, "A", "ACTIVE");
    int number = newIssue(owner, p, "T");
    issueCycleService.replace(owner, p.key(), number, List.of(active.id()));
    Long id = issueId(p, number);
    OffsetDateTime before = IssueSeeds.rewindUpdatedAt(dsl, id);

    var res =
        cycleService.complete(
            owner,
            p.key(),
            active.id(),
            new CycleCompleteRequest(
                CycleCompleteRequest.Destination.NEW,
                null,
                null,
                "B",
                LocalDate.now(),
                LocalDate.now().plusDays(14)));

    // 실제로 새 사이클에 붙었는데도 수정 시각은 그대로여야 한다
    assertThat(issueCycleService.list(owner, p.key(), number))
        .extracting("id")
        .contains(res.targetCycle().id());
    assertThat(IssueSeeds.updatedAt(dsl, id)).isEqualTo(before);
  }
}
