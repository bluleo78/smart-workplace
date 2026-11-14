package com.workplace.cycle.service;

import static com.workplace.jooq.Tables.ISSUE_CYCLE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.cycle.dto.CreateCycleRequest;
import com.workplace.cycle.dto.CycleCompleteRequest;
import com.workplace.cycle.dto.CycleCompleteRequest.Destination;
import com.workplace.cycle.dto.CycleCompleteResponse;
import com.workplace.cycle.dto.CycleResponse;
import com.workplace.cycle.exception.CycleNameDuplicatedException;
import com.workplace.cycle.exception.CycleNotFoundException;
import com.workplace.cycle.exception.InvalidCycleDateRangeException;
import com.workplace.cycle.exception.InvalidCycleStatusException;
import com.workplace.global.realtime.ResourceChangedEvent;
import com.workplace.issue.dto.IssueRow;
import com.workplace.issue.dto.IssueStatuses;
import com.workplace.issue.outbound.IssueChangeNotifier;
import com.workplace.issue.repository.IssueRepository;
import com.workplace.issue.support.IssueSeeds;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.dto.ProjectResponse;
import com.workplace.project.exception.ProjectAccessDeniedException;
import com.workplace.project.repository.ProjectMemberRepository;
import com.workplace.project.service.ProjectService;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.event.ApplicationEvents;
import org.springframework.test.context.event.RecordApplicationEvents;
import org.springframework.transaction.annotation.Transactional;

/**
 * CycleService.complete() 통합 테스트(WP-1578).
 *
 * <p>진행 중 사이클 완료, 미완료 이슈를 새 사이클·예정 사이클로 보내기, 요청·대상 검증(모든 쓰기 전에 거절해 원 사이클이 진행 중으로 남는지), 이미 붙은 이슈
 * 건너뛰기, 붙인 이슈마다의 이슈 변경 알림을 본다. 테스트 트랜잭션 안이라 실제 롤백(이름 중복)은 {@code CycleCompleteEndpointTest} 가 커밋
 * 경로로 확인한다.
 */
@Transactional
@RecordApplicationEvents
class CycleCompleteServiceTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired CycleService cycleService;
  @Autowired ProjectService projectService;
  @Autowired ProjectMemberRepository memberRepository;
  @Autowired IssueRepository issueRepository;
  @Autowired ApplicationEvents appEvents;

  private static final LocalDate D1 = LocalDate.of(2026, 6, 1);
  private static final LocalDate D14 = LocalDate.of(2026, 6, 14);
  private static final LocalDate D15 = LocalDate.of(2026, 6, 15);
  private static final LocalDate D28 = LocalDate.of(2026, 6, 28);

  /** 이슈 번호 — 테스트마다 새 인스턴스라 1부터 센다(프로젝트도 테스트마다 새로 만든다). */
  private int issueNumberSeq = 1;

  // ─── NONE ────────────────────────────────────────────────────────────────

  /** NONE — 사이클만 완료되고 대상 사이클은 없다. 미완료 이슈는 완료 사이클에 그대로 남는다. */
  @Test
  void none_completes_cycle_only() {
    Long owner = createUser();
    ProjectResponse p = newProject(owner);
    var active = cycle(owner, p, "GW-1", D1, D14, "ACTIVE");
    IssueRow issue = seedIssue(p.id(), IssueStatuses.TODO, owner);
    attach(issue.id(), active.id());

    CycleCompleteResponse resp = cycleService.complete(owner, p.key(), active.id(), none());

    assertThat(resp.completedCycle().status()).isEqualTo("COMPLETED");
    assertThat(resp.targetCycle()).isNull();
    assertThat(cycleIdsOf(issue.id())).containsExactly(active.id());
  }

  // ─── NEW ─────────────────────────────────────────────────────────────────

  /** NEW — 새 사이클이 진행 중으로 생기고 미완료 이슈만 붙는다. 완료 이슈·이전 연결은 그대로다. */
  @Test
  void new_destination_creates_active_cycle_and_attaches_incomplete() {
    Long owner = createUser();
    ProjectResponse p = newProject(owner);
    var active = cycle(owner, p, "GW-A", D1, D14, "ACTIVE");
    IssueRow todo = seedIssue(p.id(), IssueStatuses.TODO, owner);
    IssueRow doing = seedIssue(p.id(), "IN_PROGRESS", owner);
    IssueRow done = seedIssue(p.id(), "DONE", owner);
    attach(todo.id(), active.id());
    attach(doing.id(), active.id());
    attach(done.id(), active.id());

    CycleCompleteResponse resp =
        cycleService.complete(owner, p.key(), active.id(), toNew("GW-B", D15, D28));

    assertThat(resp.completedCycle().status()).isEqualTo("COMPLETED");
    CycleResponse target = resp.targetCycle();
    assertThat(target).isNotNull();
    assertThat(target.name()).isEqualTo("GW-B");
    assertThat(target.status()).isEqualTo("ACTIVE");
    assertThat(target.startDate()).isEqualTo(D15);
    assertThat(target.endDate()).isEqualTo(D28);
    assertThat(cycleIdsOf(todo.id())).containsExactlyInAnyOrder(active.id(), target.id());
    assertThat(cycleIdsOf(doing.id())).containsExactlyInAnyOrder(active.id(), target.id());
    assertThat(cycleIdsOf(done.id())).containsExactly(active.id());
  }

  /** NEW 이름은 한 줄로 다듬어 저장한다 — 사이클 생성(CreateCycleRequest)과 같은 규칙. */
  @Test
  void new_destination_normalizes_name() {
    Long owner = createUser();
    ProjectResponse p = newProject(owner);
    var active = cycle(owner, p, "GW-1", D1, D14, "ACTIVE");

    CycleCompleteResponse resp =
        cycleService.complete(owner, p.key(), active.id(), toNew("  GW-2\n", D15, D28));

    assertThat(resp.targetCycle().name()).isEqualTo("GW-2");
  }

  /** NEW 는 시작일·종료일 둘 다 필요하다 — 종료일이 없으면 거절하고 원 사이클은 진행 중 그대로다. */
  @Test
  void new_destination_requires_both_dates() {
    Long owner = createUser();
    ProjectResponse p = newProject(owner);
    var active = cycle(owner, p, "GW-1", D1, D14, "ACTIVE");

    assertThatThrownBy(
            () -> cycleService.complete(owner, p.key(), active.id(), toNew("GW-2", D15, null)))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessageContaining("종료일");
    assertThatThrownBy(
            () -> cycleService.complete(owner, p.key(), active.id(), toNew("GW-2", null, D28)))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessageContaining("시작일");
    assertThatThrownBy(
            () -> cycleService.complete(owner, p.key(), active.id(), toNew(" ", D15, D28)))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessageContaining("이름");

    assertThat(statusOf(owner, p, active.id())).isEqualTo("ACTIVE");
    assertThat(cycleService.list(owner, p.key())).hasSize(1);
  }

  /** NEW 기간이 거꾸로면(시작 > 종료) 기간 오류로 거절하고 아무것도 바꾸지 않는다. */
  @Test
  void new_destination_rejects_reversed_dates() {
    Long owner = createUser();
    ProjectResponse p = newProject(owner);
    var active = cycle(owner, p, "GW-1", D1, D14, "ACTIVE");

    assertThatThrownBy(
            () -> cycleService.complete(owner, p.key(), active.id(), toNew("GW-2", D28, D15)))
        .isInstanceOf(InvalidCycleDateRangeException.class);
    assertThat(statusOf(owner, p, active.id())).isEqualTo("ACTIVE");
    assertThat(cycleService.list(owner, p.key())).hasSize(1);
  }

  /** NEW 이름이 기존 사이클과 겹치면 409 예외(실제 롤백은 엔드포인트 테스트가 커밋 경로로 본다). */
  @Test
  void new_destination_duplicate_name_throws() {
    Long owner = createUser();
    ProjectResponse p = newProject(owner);
    var active = cycle(owner, p, "GW-A", D1, D14, "ACTIVE");
    cycle(owner, p, "GW-B", D15, D28, "PLANNED");

    assertThatThrownBy(
            () -> cycleService.complete(owner, p.key(), active.id(), toNew("GW-B", D15, D28)))
        .isInstanceOf(CycleNameDuplicatedException.class);
  }

  // ─── SCHEDULED ───────────────────────────────────────────────────────────

  /** SCHEDULED + startImmediately 미지정(기본 true) — 예정 사이클이 진행 중으로 바뀌고 미완료 이슈가 붙는다. */
  @Test
  void scheduled_start_immediately_true_activates() {
    Long owner = createUser();
    ProjectResponse p = newProject(owner);
    var active = cycle(owner, p, "GW-1", D1, D14, "ACTIVE");
    var planned = cycle(owner, p, "GW-2", D15, D28, "PLANNED");
    IssueRow issue = seedIssue(p.id(), "IN_PROGRESS", owner);
    attach(issue.id(), active.id());

    CycleCompleteResponse resp =
        cycleService.complete(owner, p.key(), active.id(), toScheduled(planned.id(), null));

    assertThat(resp.completedCycle().status()).isEqualTo("COMPLETED");
    assertThat(resp.targetCycle().id()).isEqualTo(planned.id());
    assertThat(resp.targetCycle().status()).isEqualTo("ACTIVE");
    assertThat(statusOf(owner, p, planned.id())).isEqualTo("ACTIVE");
    assertThat(cycleIdsOf(issue.id())).containsExactlyInAnyOrder(active.id(), planned.id());
  }

  /** SCHEDULED + startImmediately=false — 예정 사이클은 예정 그대로이고 이슈만 붙는다. */
  @Test
  void scheduled_start_immediately_false_keeps_planned() {
    Long owner = createUser();
    ProjectResponse p = newProject(owner);
    var active = cycle(owner, p, "GW-1", D1, D14, "ACTIVE");
    var planned = cycle(owner, p, "GW-2", D15, D28, "PLANNED");
    IssueRow issue = seedIssue(p.id(), "IN_PROGRESS", owner);
    attach(issue.id(), active.id());

    CycleCompleteResponse resp =
        cycleService.complete(owner, p.key(), active.id(), toScheduled(planned.id(), false));

    assertThat(resp.targetCycle().id()).isEqualTo(planned.id());
    assertThat(resp.targetCycle().status()).isEqualTo("PLANNED");
    assertThat(statusOf(owner, p, planned.id())).isEqualTo("PLANNED");
    assertThat(cycleIdsOf(issue.id())).containsExactlyInAnyOrder(active.id(), planned.id());
  }

  /** SCHEDULED 대상이 예정이 아니면(완료·진행 중) 거절하고 원 사이클은 진행 중 그대로다(쓰기 전에 검증). */
  @Test
  void scheduled_target_must_be_planned() {
    Long owner = createUser();
    ProjectResponse p = newProject(owner);
    var active = cycle(owner, p, "GW-1", D1, D14, "ACTIVE");
    var completed = cycle(owner, p, "GW-0", D1, D14, "COMPLETED");
    var otherActive = cycle(owner, p, "GW-X", D15, D28, "ACTIVE");
    IssueRow issue = seedIssue(p.id(), IssueStatuses.TODO, owner);
    attach(issue.id(), active.id());

    assertThatThrownBy(
            () ->
                cycleService.complete(
                    owner, p.key(), active.id(), toScheduled(completed.id(), null)))
        .isInstanceOf(InvalidCycleStatusException.class)
        .hasMessage("예정 사이클로만 보낼 수 있습니다");
    assertThatThrownBy(
            () ->
                cycleService.complete(
                    owner, p.key(), active.id(), toScheduled(otherActive.id(), null)))
        .isInstanceOf(InvalidCycleStatusException.class);

    assertThat(statusOf(owner, p, active.id())).isEqualTo("ACTIVE");
    assertThat(cycleIdsOf(issue.id())).containsExactly(active.id());
  }

  /** SCHEDULED 대상이 완료하는 사이클 자신이면 400 계열(IllegalArgumentException)로 거절한다. */
  @Test
  void scheduled_target_cannot_be_self() {
    Long owner = createUser();
    ProjectResponse p = newProject(owner);
    var active = cycle(owner, p, "GW-1", D1, D14, "ACTIVE");

    assertThatThrownBy(
            () ->
                cycleService.complete(owner, p.key(), active.id(), toScheduled(active.id(), null)))
        .isInstanceOf(IllegalArgumentException.class);
    assertThat(statusOf(owner, p, active.id())).isEqualTo("ACTIVE");
  }

  /** SCHEDULED 대상이 다른 프로젝트 사이클이면 없는 사이클과 같게 404 로 거절한다. */
  @Test
  void scheduled_target_other_project() {
    Long owner = createUser();
    ProjectResponse p = newProject(owner);
    ProjectResponse other = newProject(owner);
    var active = cycle(owner, p, "GW-1", D1, D14, "ACTIVE");
    var foreign = cycle(owner, other, "GW-2", D15, D28, "PLANNED");

    assertThatThrownBy(
            () ->
                cycleService.complete(owner, p.key(), active.id(), toScheduled(foreign.id(), null)))
        .isInstanceOf(CycleNotFoundException.class);
    assertThat(statusOf(owner, p, active.id())).isEqualTo("ACTIVE");
    assertThat(statusOf(owner, other, foreign.id())).isEqualTo("PLANNED");
  }

  /** SCHEDULED 인데 targetCycleId 가 없으면 400 계열로 거절한다. */
  @Test
  void scheduled_requires_target_id() {
    Long owner = createUser();
    ProjectResponse p = newProject(owner);
    var active = cycle(owner, p, "GW-1", D1, D14, "ACTIVE");

    assertThatThrownBy(
            () -> cycleService.complete(owner, p.key(), active.id(), toScheduled(null, null)))
        .isInstanceOf(IllegalArgumentException.class);
    assertThat(statusOf(owner, p, active.id())).isEqualTo("ACTIVE");
  }

  /** 대상에 이미 붙어 있던 이슈는 연결이 하나로 남고, 알림도 내지 않는다. */
  @Test
  void already_attached_issue_skipped() {
    Long owner = createUser();
    ProjectResponse p = newProject(owner);
    var active = cycle(owner, p, "GW-1", D1, D14, "ACTIVE");
    var planned = cycle(owner, p, "GW-2", D15, D28, "PLANNED");
    IssueRow both = seedIssue(p.id(), "IN_PROGRESS", owner);
    IssueRow only = seedIssue(p.id(), IssueStatuses.TODO, owner);
    attach(both.id(), active.id());
    attach(both.id(), planned.id());
    attach(only.id(), active.id());
    appEvents.clear();

    cycleService.complete(owner, p.key(), active.id(), toScheduled(planned.id(), null));

    assertThat(cycleIdsOf(both.id())).containsExactlyInAnyOrder(active.id(), planned.id());
    assertThat(cycleIdsOf(only.id())).containsExactlyInAnyOrder(active.id(), planned.id());
    assertThat(updatedIssueIds()).containsExactly(only.id());
  }

  /** 붙인 이슈마다 이슈 변경 알림(updated)을 한 번씩 낸다 — 이슈 화면·목록이 실시간으로 갱신되게. */
  @Test
  void issue_events_published_per_attached_issue() {
    Long owner = createUser();
    ProjectResponse p = newProject(owner);
    var active = cycle(owner, p, "GW-1", D1, D14, "ACTIVE");
    IssueRow a = seedIssue(p.id(), IssueStatuses.TODO, owner);
    IssueRow b = seedIssue(p.id(), "IN_PROGRESS", owner);
    IssueRow done = seedIssue(p.id(), "DONE", owner);
    attach(a.id(), active.id());
    attach(b.id(), active.id());
    attach(done.id(), active.id());
    appEvents.clear();

    cycleService.complete(owner, p.key(), active.id(), toNew("GW-2", D15, D28));

    List<ResourceChangedEvent> events = issueUpdatedEvents();
    assertThat(events).hasSize(2);
    assertThat(updatedIssueIds()).containsExactlyInAnyOrder(a.id(), b.id());
    assertThat(events)
        .allSatisfy(
            ev -> {
              assertThat(ev.scopeId()).isEqualTo(p.id());
              assertThat(ev.attrs()).containsEntry("projectKey", p.key());
              assertThat(ev.actorId()).isEqualTo(owner);
            });
  }

  /**
   * 다른 프로젝트 이슈가 (잘못) 붙어 있어도 이 프로젝트 이슈만 보낸다 — 완료 창의 미완료 수(프로젝트 진행 집계)와 실제 붙이는 집합이 같고, 알림의 projectKey
   * 가 틀린 이슈를 가리키지 않게.
   */
  @Test
  void only_issues_of_same_project_attached() {
    Long owner = createUser();
    ProjectResponse p = newProject(owner);
    ProjectResponse other = newProject(owner);
    var active = cycle(owner, p, "GW-1", D1, D14, "ACTIVE");
    IssueRow mine = seedIssue(p.id(), IssueStatuses.TODO, owner);
    IssueRow foreign = seedIssue(other.id(), IssueStatuses.TODO, owner);
    attach(mine.id(), active.id());
    attach(foreign.id(), active.id());
    appEvents.clear();

    CycleCompleteResponse resp =
        cycleService.complete(owner, p.key(), active.id(), toNew("GW-2", D15, D28));

    assertThat(cycleIdsOf(mine.id()))
        .containsExactlyInAnyOrder(active.id(), resp.targetCycle().id());
    assertThat(cycleIdsOf(foreign.id())).containsExactly(active.id());
    assertThat(updatedIssueIds()).containsExactly(mine.id());
  }

  // ─── 상태·권한 ───────────────────────────────────────────────────────────

  /** 진행 중이 아닌 사이클은 완료할 수 없다. */
  @Test
  void non_active_cycle_rejected() {
    Long owner = createUser();
    ProjectResponse p = newProject(owner);
    var planned = cycle(owner, p, "GW-1", D1, D14, "PLANNED");

    assertThatThrownBy(() -> cycleService.complete(owner, p.key(), planned.id(), none()))
        .isInstanceOf(InvalidCycleStatusException.class)
        .hasMessage("진행 중인 사이클만 완료할 수 있습니다");
  }

  /** 프로젝트 OWNER 가 아닌 멤버는 완료할 수 없다. */
  @Test
  void member_cannot_complete() {
    Long owner = createUser();
    Long member = createUser();
    ProjectResponse p = newProject(owner);
    memberRepository.insert(p.id(), member, "MEMBER");
    var active = cycle(owner, p, "GW-1", D1, D14, "ACTIVE");

    assertThatThrownBy(() -> cycleService.complete(member, p.key(), active.id(), none()))
        .isInstanceOf(ProjectAccessDeniedException.class);
    assertThat(statusOf(owner, p, active.id())).isEqualTo("ACTIVE");
  }

  // ─── 헬퍼 ─────────────────────────────────────────────────────────────────

  private static CycleCompleteRequest none() {
    return new CycleCompleteRequest(Destination.NONE, null, null, null, null, null);
  }

  private static CycleCompleteRequest toNew(String name, LocalDate start, LocalDate end) {
    return new CycleCompleteRequest(Destination.NEW, null, null, name, start, end);
  }

  private static CycleCompleteRequest toScheduled(Long targetId, Boolean startNow) {
    return new CycleCompleteRequest(Destination.SCHEDULED, targetId, startNow, null, null, null);
  }

  /** USER 역할의 현재 테넌트 ACTIVE 멤버를 만든다. */
  private Long createUser() {
    long id = TestFixtures.createHuman(dsl);
    TestFixtures.grantRole(dsl, id, "USER");
    return TestFixtures.activeMemberOfCurrentTenant(dsl, id);
  }

  /** 고유 키로 프로젝트를 만든다(호출자가 OWNER). */
  private ProjectResponse newProject(Long ownerId) {
    String key = "CC" + UUID.randomUUID().toString().replace("-", "").toUpperCase().substring(0, 6);
    return projectService.create(ownerId, new CreateProjectRequest(key, "P-" + key, "x"));
  }

  private CycleResponse cycle(
      Long owner, ProjectResponse p, String name, LocalDate start, LocalDate end, String status) {
    return cycleService.create(
        owner, p.key(), new CreateCycleRequest(name, null, start, end, status));
  }

  /** 주어진 범주 상태의 이슈를 만든다 — IssueSeeds.insert 는 TODO 로 만들므로 다른 범주는 바꾼다. */
  private IssueRow seedIssue(Long projectId, String category, Long reporterId) {
    var row =
        IssueSeeds.insert(
            issueRepository, dsl, projectId, issueNumberSeq++, "T", null, "MID", null, reporterId);
    if (!IssueStatuses.TODO.equals(category)) {
      IssueSeeds.updateAll(
          issueRepository, dsl, row.id(), "T", null, category, "MID", null, null, null, null);
    }
    return row;
  }

  private void attach(Long issueId, Long cycleId) {
    dsl.insertInto(ISSUE_CYCLE)
        .set(ISSUE_CYCLE.ISSUE_ID, issueId)
        .set(ISSUE_CYCLE.CYCLE_ID, cycleId)
        .execute();
  }

  private List<Long> cycleIdsOf(Long issueId) {
    return dsl.select(ISSUE_CYCLE.CYCLE_ID)
        .from(ISSUE_CYCLE)
        .where(ISSUE_CYCLE.ISSUE_ID.eq(issueId))
        .fetch(ISSUE_CYCLE.CYCLE_ID);
  }

  private String statusOf(Long owner, ProjectResponse p, Long cycleId) {
    return cycleService.list(owner, p.key()).stream()
        .filter(c -> c.id().equals(cycleId))
        .findFirst()
        .orElseThrow()
        .status();
  }

  /** 기록된 이슈 updated 알림. */
  private List<ResourceChangedEvent> issueUpdatedEvents() {
    return appEvents.stream(ResourceChangedEvent.class)
        .filter(ev -> IssueChangeNotifier.RESOURCE_ISSUE.equals(ev.resource()))
        .filter(ev -> ResourceChangedEvent.OP_UPDATED.equals(ev.op()))
        .toList();
  }

  /** 이슈 updated 알림이 가리킨 이슈 id 들(알림 하나에 이슈 하나). */
  private List<Long> updatedIssueIds() {
    return issueUpdatedEvents().stream().flatMap(ev -> ev.ids().stream()).toList();
  }
}
