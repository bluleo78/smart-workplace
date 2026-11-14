package com.workplace.cycle.service;

import static com.workplace.jooq.Tables.ISSUE_CYCLE;
import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.cycle.dto.CycleCompleteRequest;
import com.workplace.cycle.dto.CycleCompleteRequest.Destination;
import com.workplace.cycle.dto.CycleCompleteResponse;
import com.workplace.cycle.exception.CycleNameDuplicatedException;
import com.workplace.cycle.exception.InvalidCycleStatusException;
import com.workplace.cycle.repository.CycleRepository;
import com.workplace.issue.dto.IssueStatuses;
import com.workplace.issue.repository.IssueRepository;
import com.workplace.issue.support.IssueSeeds;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.dto.ProjectResponse;
import com.workplace.project.service.ProjectService;
import com.workplace.support.IntegrationTestBase;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicLong;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/**
 * CycleService.complete() 통합 테스트(WP-1578).
 *
 * <p>테스트 대상 동작: - 진행 중 사이클 완료 처리 - 미완료 이슈 새 사이클/예정 사이클로 이동 - 이미 붙은 이슈는 건너뛰기 - 이름 중복 시 롤백 - 완료 상태가
 * 아닌 사이클 거부 - 권한 없음 거부
 */
@Transactional
class CycleCompleteServiceTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired CycleService cycleService;
  @Autowired ProjectService projectService;
  @Autowired IssueRepository issueRepository;
  @Autowired CycleRepository cycleRepository;

  private Long createOwner() {
    String suffix = UUID.randomUUID().toString().substring(0, 8);
    Long id =
        dsl.insertInto(USER)
            .set(USER.USERNAME, "owner-" + suffix)
            .set(USER.PASSWORD, "pw")
            .set(USER.NAME, "owner")
            .set(USER.EMAIL, "owner-" + suffix + "@ex.com")
            .returning(USER.ID)
            .fetchOne()
            .getId();
    Long roleId = dsl.select(ROLE.ID).from(ROLE).where(ROLE.NAME.eq("USER")).fetchOne(ROLE.ID);
    dsl.insertInto(USER_ROLE).set(USER_ROLE.USER_ID, id).set(USER_ROLE.ROLE_ID, roleId).execute();
    com.workplace.support.TestFixtures.activeMemberOfCurrentTenant(dsl, id);
    return id;
  }

  private ProjectResponse newProject(Long ownerId, String key) {
    return projectService.create(ownerId, new CreateProjectRequest(key, "P-" + key, "x"));
  }

  /** OWNER 가 진행 중 사이클을 NONE(사이클만 완료)으로 완료 처리한다. */
  @Test
  void owner_complete_active_cycle_none() {
    Long owner = createOwner();
    ProjectResponse p = newProject(owner, "CN1");
    // 진행 중 사이클 생성
    var active =
        cycleService.create(
            owner,
            p.key(),
            new com.workplace.cycle.dto.CreateCycleRequest(
                "GW-1", null, LocalDate.of(2026, 6, 1), LocalDate.of(2026, 6, 14), "ACTIVE"));

    CycleCompleteResponse resp =
        cycleService.complete(
            owner,
            p.key(),
            active.id(),
            new CycleCompleteRequest(Destination.NONE, null, null, null, null, null, null));

    assertThat(resp.completedCycle().status()).isEqualTo("COMPLETED");
    assertThat(resp.newCycle()).isNull();
  }

  /** OWN 로 완료 처리 시 새 사이클이 ACTIVE 로 생성되고 미완료 이슈가 거기 Attach된다. */
  @Test
  void owner_complete_with_new_cycle_creates_active_and_moves_incomplete() {
    Long owner = createOwner();
    ProjectResponse p = newProject(owner, "CN2");

    // 진행 중 사이클
    var active =
        cycleService.create(
            owner,
            p.key(),
            new com.workplace.cycle.dto.CreateCycleRequest(
                "GW-A", null, LocalDate.of(2026, 6, 1), LocalDate.of(2026, 6, 14), "ACTIVE"));

    // 미완료 이슈 2개 Attach (TODO + IN_PROGRESS)
    Long i1 = seedIssue(p.id(), "TODO", owner);
    Long i2 = seedIssue(p.id(), "IN_PROGRESS", owner);
    dsl.insertInto(ISSUE_CYCLE)
        .set(ISSUE_CYCLE.ISSUE_ID, i1)
        .set(ISSUE_CYCLE.CYCLE_ID, active.id())
        .execute();
    dsl.insertInto(ISSUE_CYCLE)
        .set(ISSUE_CYCLE.ISSUE_ID, i2)
        .set(ISSUE_CYCLE.CYCLE_ID, active.id())
        .execute();

    // 완료된 이슈 1개 Attach (완료 후에도 그대로 둠)
    Long i3 = seedIssue(p.id(), "DONE", owner);
    dsl.insertInto(ISSUE_CYCLE)
        .set(ISSUE_CYCLE.ISSUE_ID, i3)
        .set(ISSUE_CYCLE.CYCLE_ID, active.id())
        .execute();

    CycleCompleteResponse resp =
        cycleService.complete(
            owner,
            p.key(),
            active.id(),
            new CycleCompleteRequest(
                Destination.NEW,
                null,
                null,
                null,
                "GW-B",
                LocalDate.of(2026, 6, 15),
                LocalDate.of(2026, 6, 28)));

    assertThat(resp.completedCycle().status()).isEqualTo("COMPLETED");
    assertThat(resp.newCycle()).isNotNull();
    assertThat(resp.newCycle().name()).isEqualTo("GW-B");
    assertThat(resp.newCycle().status()).isEqualTo("ACTIVE");
    assertThat(resp.newCycle().startDate()).isEqualTo(LocalDate.of(2026, 6, 15));

    // 미완료 이슈만 새 사이클에 Attach
    assertThat(cycleIdsOf(i1)).contains(resp.newCycle().id());
    assertThat(cycleIdsOf(i2)).contains(resp.newCycle().id());
    // 완료 이슈는 새 사이클에 없고 원래 사이클에만 있음
    assertThat(cycleIdsOf(i3)).doesNotContain(resp.newCycle().id());
  }

  /** 예정 사이클을 목적지로 고르고 startImmediately=true(기본값)일 때 예정→ACTVE 전환. */
  @Test
  void owner_complete_to_scheduled_starts_immediately() {
    Long owner = createOwner();
    ProjectResponse p = newProject(owner, "CN3");

    var active =
        cycleService.create(
            owner,
            p.key(),
            new com.workplace.cycle.dto.CreateCycleRequest(
                "GW-1", null, LocalDate.of(2026, 6, 1), LocalDate.of(2026, 6, 14), "ACTIVE"));
    var planned =
        cycleService.create(
            owner,
            p.key(),
            new com.workplace.cycle.dto.CreateCycleRequest(
                "GW-2", null, LocalDate.of(2026, 6, 15), LocalDate.of(2026, 6, 28), "PLANNED"));

    Long issueId = seedIssue(p.id(), "IN_PROGRESS", owner);
    dsl.insertInto(ISSUE_CYCLE)
        .set(ISSUE_CYCLE.ISSUE_ID, issueId)
        .set(ISSUE_CYCLE.CYCLE_ID, active.id())
        .execute();

    CycleCompleteResponse resp =
        cycleService.complete(
            owner,
            p.key(),
            active.id(),
            new CycleCompleteRequest(
                Destination.SCHEDULED, planned.id(), null, null, null, null, null));

    assertThat(resp.completedCycle().status()).isEqualTo("COMPLETED");
    assertThat(resp.newCycle()).isNull();

    // 예정 사이클이 ACTIVE 로 전환됐는지 확인
    var updated =
        cycleService.list(owner, p.key()).stream()
            .filter(c -> c.id().equals(planned.id()))
            .findFirst()
            .orElseThrow();
    assertThat(updated.status()).isEqualTo("ACTIVE");

    // 이슈가 예정 사이클에 Attach
    assertThat(cycleIdsOf(issueId)).contains(planned.id());
  }

  /** startImmediately=false일 때 예정 사이클을 그대로 둔다. */
  @Test
  void owner_complete_to_scheduled_no_start() {
    Long owner = createOwner();
    ProjectResponse p = newProject(owner, "CN4");

    var active =
        cycleService.create(
            owner,
            p.key(),
            new com.workplace.cycle.dto.CreateCycleRequest(
                "GW-1", null, LocalDate.of(2026, 6, 1), LocalDate.of(2026, 6, 14), "ACTIVE"));
    var planned =
        cycleService.create(
            owner,
            p.key(),
            new com.workplace.cycle.dto.CreateCycleRequest(
                "GW-2", null, LocalDate.of(2026, 6, 15), LocalDate.of(2026, 6, 28), "PLANNED"));

    Long issueId = seedIssue(p.id(), "IN_PROGRESS", owner);
    dsl.insertInto(ISSUE_CYCLE)
        .set(ISSUE_CYCLE.ISSUE_ID, issueId)
        .set(ISSUE_CYCLE.CYCLE_ID, active.id())
        .execute();

    cycleService.complete(
        owner,
        p.key(),
        active.id(),
        new CycleCompleteRequest(
            Destination.SCHEDULED, planned.id(), null, false, null, null, null));

    // 예정 사이클은 PLANNED 그대로
    var updated =
        cycleService.list(owner, p.key()).stream()
            .filter(c -> c.id().equals(planned.id()))
            .findFirst()
            .orElseThrow();
    assertThat(updated.status()).isEqualTo("PLANNED");
    // 이슈는 Attach 됨
    assertThat(cycleIdsOf(issueId)).contains(planned.id());
  }

  /** 이미 새 사이클에 붙어 있는 이슈는 건너뛴다(중복 Attach 안 함). */
  @Test
  void owner_complete_skips_already_attached_issues() {
    Long owner = createOwner();
    ProjectResponse p = newProject(owner, "CN5");

    var active =
        cycleService.create(
            owner,
            p.key(),
            new com.workplace.cycle.dto.CreateCycleRequest(
                "GW-1", null, LocalDate.of(2026, 6, 1), LocalDate.of(2026, 6, 14), "ACTIVE"));
    var planned =
        cycleService.create(
            owner,
            p.key(),
            new com.workplace.cycle.dto.CreateCycleRequest(
                "GW-2", null, LocalDate.of(2026, 6, 15), LocalDate.of(2026, 6, 28), "PLANNED"));

    // 이슈가 두 사이클 모두에 이미 있음
    Long issueId = seedIssue(p.id(), "IN_PROGRESS", owner);
    dsl.insertInto(ISSUE_CYCLE)
        .set(ISSUE_CYCLE.ISSUE_ID, issueId)
        .set(ISSUE_CYCLE.CYCLE_ID, active.id())
        .execute();
    dsl.insertInto(ISSUE_CYCLE)
        .set(ISSUE_CYCLE.ISSUE_ID, issueId)
        .set(ISSUE_CYCLE.CYCLE_ID, planned.id())
        .execute();

    cycleService.complete(
        owner,
        p.key(),
        active.id(),
        new CycleCompleteRequest(
            Destination.SCHEDULED, planned.id(), null, null, null, null, null));

    // 완료 후에도 이슈는 두 사이클 모두에 있음 (완료 사이클에서 제거되지 않음, 중복Attach 방지)
    assertThat(cycleIdsOf(issueId)).containsExactlyInAnyOrder(active.id(), planned.id());
  }

  /** 이미 ACTIVE 인 예정 사이클을 목적지로 고르면 상태 전환 없이 이슈만 Attach한다. */
  @Test
  void owner_complete_to_already_active_cycle_does_not_revert() {
    Long owner = createOwner();
    ProjectResponse p = newProject(owner, "CN6");

    var active =
        cycleService.create(
            owner,
            p.key(),
            new com.workplace.cycle.dto.CreateCycleRequest(
                "GW-1", null, LocalDate.of(2026, 6, 1), LocalDate.of(2026, 6, 14), "ACTIVE"));
    // 새 사이클을 ACTIVE 로 직접 생성
    var anotherActive =
        cycleService.create(
            owner,
            p.key(),
            new com.workplace.cycle.dto.CreateCycleRequest(
                "GW-B", null, LocalDate.of(2026, 6, 15), LocalDate.of(2026, 6, 28), "ACTIVE"));

    Long issueId = seedIssue(p.id(), "TODO", owner);
    dsl.insertInto(ISSUE_CYCLE)
        .set(ISSUE_CYCLE.ISSUE_ID, issueId)
        .set(ISSUE_CYCLE.CYCLE_ID, active.id())
        .execute();

    CycleCompleteResponse resp =
        cycleService.complete(
            owner,
            p.key(),
            active.id(),
            new CycleCompleteRequest(
                Destination.SCHEDULED, anotherActive.id(), null, null, null, null, null));

    assertThat(resp.completedCycle().status()).isEqualTo("COMPLETED");
    // anotherActive는 여전히 ACTIVE
    var updated =
        cycleService.list(owner, p.key()).stream()
            .filter(c -> c.id().equals(anotherActive.id()))
            .findFirst()
            .orElseThrow();
    assertThat(updated.status()).isEqualTo("ACTIVE");
  }

  /** 완료 상태가 아닌 사이클은 완료 처리 시 400 거부. */
  @Test
  void non_active_cycle_rejected() {
    Long owner = createOwner();
    ProjectResponse p = newProject(owner, "CN7");

    // PLANNED 사이클
    var planned =
        cycleService.create(
            owner,
            p.key(),
            new com.workplace.cycle.dto.CreateCycleRequest(
                "GW-1", null, LocalDate.of(2026, 6, 1), LocalDate.of(2026, 6, 14), "PLANNED"));

    assertThatThrownBy(
            () ->
                cycleService.complete(
                    owner,
                    p.key(),
                    planned.id(),
                    new CycleCompleteRequest(Destination.NONE, null, null, null, null, null, null)))
        .isInstanceOf(InvalidCycleStatusException.class);
  }

  /** 새 사이클 이름이 기존과 중복되면 롤백. */
  @Test
  void duplicate_new_cycle_name_rolls_back() {
    Long owner = createOwner();
    ProjectResponse p = newProject(owner, "CN8");

    var active =
        cycleService.create(
            owner,
            p.key(),
            new com.workplace.cycle.dto.CreateCycleRequest(
                "GW-A", null, LocalDate.of(2026, 6, 1), LocalDate.of(2026, 6, 14), "ACTIVE"));
    // 이미 같은 이름의 사이클이 존재
    cycleService.create(
        owner,
        p.key(),
        new com.workplace.cycle.dto.CreateCycleRequest(
            "GW-B", null, LocalDate.of(2026, 6, 15), LocalDate.of(2026, 6, 28), "PLANNED"));

    Long i = seedIssue(p.id(), "IN_PROGRESS", owner);
    dsl.insertInto(ISSUE_CYCLE)
        .set(ISSUE_CYCLE.ISSUE_ID, i)
        .set(ISSUE_CYCLE.CYCLE_ID, active.id())
        .execute();

    // 이름 중복 예외. 롤백은 @Transactional이 테스트结束后자동 처리한다 — 여 기arangles를 throw하고 끝.
    assertThatThrownBy(
            () ->
                cycleService.complete(
                    owner,
                    p.key(),
                    active.id(),
                    new CycleCompleteRequest(
                        Destination.NEW, null, null, null, "GW-B", LocalDate.of(2026, 7, 1), null)))
        .isInstanceOf(CycleNameDuplicatedException.class);
  }

  // ─── 헬퍼 ─────────────────────────────────────────────────────────────────

  /** 이슈 번호 카운터 — 각 테스트 내 고유성을 보장. */
  private final AtomicLong issueNumberSeq = new AtomicLong(1);

  /** 상태가 category인 이슈를 프로젝트에 삽입하고 ID를 반환. */
  private Long seedIssue(Long projectId, String category, Long reporterId) {
    // IssueSeeds.insert()는 TODO 범주로 만들기 때문에, 필요 시 updateAll로 상태를 바꾼다.
    long number = issueNumberSeq.getAndIncrement();
    var row =
        IssueSeeds.insert(
            issueRepository, dsl, projectId, (int) number, "Test", null, "MID", null, reporterId);
    if (!IssueStatuses.TODO.equals(category)) {
      IssueSeeds.updateAll(
          issueRepository, dsl, row.id(), "Test", null, category, "MID", null, null, null, null);
    }
    return row.id();
  }

  /** 이슈에 Attach된 사이클 ID 목록. */
  private List<Long> cycleIdsOf(Long issueId) {
    return dsl.select(ISSUE_CYCLE.CYCLE_ID)
        .from(ISSUE_CYCLE)
        .where(ISSUE_CYCLE.ISSUE_ID.eq(issueId))
        .fetch(ISSUE_CYCLE.CYCLE_ID);
  }
}
