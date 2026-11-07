package com.workplace.issue;

import static com.workplace.jooq.Tables.AUDIT_LOG;
import static com.workplace.jooq.Tables.ISSUE;
import static com.workplace.jooq.Tables.ISSUE_HISTORY;
import static com.workplace.jooq.Tables.PROJECT;
import static com.workplace.jooq.Tables.PROJECT_STATUS;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.global.tenant.TenantContext;
import com.workplace.issue.dto.CreateProjectStatusRequest;
import com.workplace.issue.dto.IssueRow;
import com.workplace.issue.repository.IssueRepository;
import com.workplace.issue.service.IssueService;
import com.workplace.issue.service.ProjectStatusService;
import com.workplace.issue.support.IssueSeeds;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.dto.ProjectResponse;
import com.workplace.project.service.ProjectService;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.RowLockWaits;
import com.workplace.support.TestFixtures;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.function.Supplier;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 잠금을 기다린 이슈 조회가 상태 이름을 잃지 않는지 본다(WP-1420).
 *
 * <p>예전 잠금 조회는 issue LEFT JOIN project_status 를 {@code FOR ... OF issue} 로 읽었다. PostgreSQL READ
 * COMMITTED 는 다른 트랜잭션이 고친 issue 행을 기다린 뒤 issue 행만 최신판으로 다시 보고(EvalPlanQual), 잠그지 않은 project_status
 * 쪽은 처음 읽은 옛 상태 행으로 조인 조건을 다시 따진다 — 새 status_id 와 맞지 않아 상태 이름·색이 null 이 되고, 이력(STATUS_CHANGED)의 이전
 * 값이 이름 대신 범주 코드(DONE 등)로 남았다.
 *
 * <p>두 트랜잭션을 실제로 겹쳐야 보이므로 비-{@code @Transactional} 로 커밋하고 끝에 자기 행만 지운다. 잠금 대기를 pg_locks 로 확인한 뒤에 상태
 * 변경을 커밋시켜 순서를 결정적으로 맞춘다.
 */
class IssueStatusLockReadRaceTest extends IntegrationTestBase {

  @Autowired IssueRepository issueRepository;
  @Autowired IssueService issueService;
  @Autowired ProjectService projectService;
  @Autowired ProjectStatusService statusService;

  private final List<Long> users = new ArrayList<>();
  private final List<Long> projects = new ArrayList<>();
  private long owner;
  private ProjectResponse project;

  @BeforeEach
  void seed() {
    TenantContext.set(1L);
    owner = TestFixtures.createHuman(baseDsl);
    TestFixtures.grantRole(baseDsl, owner, "USER");
    TestFixtures.addMember(baseDsl, owner, 1L);
    users.add(owner);
    project = newProject("SLR");
    TenantContext.clear();
  }

  @AfterEach
  void cleanup() {
    cleanupInTenant(
        1L,
        () -> {
          var ids = baseDsl.select(ISSUE.ID).from(ISSUE).where(ISSUE.PROJECT_ID.in(projects));
          baseDsl.deleteFrom(ISSUE_HISTORY).where(ISSUE_HISTORY.ISSUE_ID.in(ids)).execute();
          // 부모 FK 가 프로젝트를 가로지를 수 있어 먼저 끊는다
          baseDsl
              .update(ISSUE)
              .setNull(ISSUE.PARENT_ISSUE_ID)
              .where(ISSUE.PROJECT_ID.in(projects))
              .execute();
          baseDsl.deleteFrom(ISSUE).where(ISSUE.PROJECT_ID.in(projects)).execute();
          // project 삭제가 project_status 를 cascade 로 지운다
          baseDsl.deleteFrom(PROJECT).where(PROJECT.ID.in(projects)).execute();
          baseDsl.deleteFrom(AUDIT_LOG).where(AUDIT_LOG.USER_ID.in(users)).execute();
          baseDsl.deleteFrom(USER_ROLE).where(USER_ROLE.USER_ID.in(users)).execute();
        });
    baseDsl.deleteFrom(USER).where(USER.ID.in(users)).execute();
  }

  @Test
  void 쓰기잠금_조회가_상태변경_커밋을_기다린_뒤_새_상태_이름을_읽는다() throws Exception {
    IssueRow issue = seedIssue(project, 1);
    long done = statusId(project, "완료");

    List<IssueRow> rows =
        readWhileStatusChangeHeld(
            issue.id(),
            done,
            () ->
                issueRepository
                    .findByProjectAndNumberForUpdate(project.id(), 1)
                    .map(List::of)
                    .orElse(List.of()));

    assertThat(rows).singleElement().satisfies(r -> assertNamed(r, done, "완료"));
  }

  @Test
  void 공유잠금_번호_조회도_새_상태_이름을_읽는다() throws Exception {
    IssueRow issue = seedIssue(project, 1);
    long done = statusId(project, "완료");

    List<IssueRow> rows =
        readWhileStatusChangeHeld(
            issue.id(),
            done,
            () ->
                issueRepository
                    .findByProjectAndNumberForShare(project.id(), 1)
                    .map(List::of)
                    .orElse(List.of()));

    assertThat(rows).singleElement().satisfies(r -> assertNamed(r, done, "완료"));
  }

  @Test
  void 공유잠금_id_조회도_새_상태_이름을_읽는다() throws Exception {
    IssueRow issue = seedIssue(project, 1);
    long done = statusId(project, "완료");

    List<IssueRow> rows =
        readWhileStatusChangeHeld(
            issue.id(),
            done,
            () ->
                issueRepository.findActiveByIdForShare(issue.id()).map(List::of).orElse(List.of()));

    assertThat(rows).singleElement().satisfies(r -> assertNamed(r, done, "완료"));
  }

  @Test
  void 하위_잠금_조회도_새_상태_이름을_id순으로_읽는다() throws Exception {
    IssueRow parent = seedIssue(project, 1);
    IssueRow first = seedIssue(project, 2);
    IssueRow second = seedIssue(project, 3);
    callInTenant(
        1L,
        () -> {
          issueRepository.updateParent(second.id(), parent.id());
          issueRepository.updateParent(first.id(), parent.id());
          return null;
        });
    long done = statusId(project, "완료");

    List<IssueRow> rows =
        readWhileStatusChangeHeld(
            second.id(), done, () -> issueRepository.lockActiveChildren(parent.id()));

    assertThat(rows).extracting(IssueRow::id).containsExactly(first.id(), second.id());
    // 잠금을 기다리지 않은 하위는 처음 상태(프로젝트 기본 할 일 상태) 그대로 — 이름은 시드가 고른 상태에서 찾는다
    assertThat(first.statusName()).isNotNull();
    assertThat(rows.get(0).statusId()).isEqualTo(first.statusId());
    assertThat(rows.get(0).statusName()).isEqualTo(first.statusName());
    assertNamed(rows.get(1), done, "완료");
  }

  @Test
  void 프로젝트를_가로지른_하위_잠금_조회도_새_상태_이름을_읽는다() throws Exception {
    ProjectResponse other = callInTenant(1L, () -> newProject("SLO"));
    IssueRow epic = seedIssue(project, 1);
    IssueRow child = seedIssue(other, 1);
    callInTenant(
        1L,
        () -> {
          issueRepository.updateParent(child.id(), epic.id());
          return null;
        });
    long done = statusId(other, "완료");

    List<IssueRow> rows =
        readWhileStatusChangeHeld(
            child.id(), done, () -> issueRepository.lockCrossProjectChildren(project.id()));

    assertThat(rows).singleElement().satisfies(r -> assertNamed(r, done, "완료"));
  }

  @Test
  void 지워진_이슈와_없는_번호는_잠금_조회가_빈_결과() {
    IssueRow issue = seedIssue(project, 1);
    callInTenant(
        1L,
        () -> {
          issueRepository.softDelete(issue.id(), Instant.now());
          return null;
        });

    callInTenant(
        1L,
        () -> {
          assertThat(issueRepository.findByProjectAndNumberForUpdate(project.id(), 1)).isEmpty();
          assertThat(issueRepository.findByProjectAndNumberForShare(project.id(), 1)).isEmpty();
          assertThat(issueRepository.findActiveByIdForShare(issue.id())).isEmpty();
          assertThat(issueRepository.findByProjectAndNumberForUpdate(project.id(), 99)).isEmpty();
          assertThat(issueRepository.lockActiveChildren(issue.id())).isEmpty();
          assertThat(issueRepository.lockCrossProjectChildren(project.id())).isEmpty();
          return null;
        });
  }

  /**
   * 같은 이슈에 상태 변경이 동시에 몰려도(각자 트랜잭션) STATUS_CHANGED 이력의 이전·다음 값이 모두 이 프로젝트의 상태 이름이다 — 범주 코드로 떨어지지
   * 않는다(WP-1420 이슈 본문의 재현: 동시 PATCH /status 6건).
   */
  // 경합 타이밍에 기대는 보조 확인이다 — 회귀를 결정적으로 막는 것은 위의 잠금 대기 테스트들이다.
  @Test
  void 동시_상태_변경의_이력은_모두_상태_이름이다() throws Exception {
    // 범주 코드와 겹치지 않는 사용자 정의 상태 둘을 더해, 같은 범주 안 이동도 섞는다
    callInTenant(
        1L,
        () -> {
          statusService.create(
              owner,
              project.key(),
              new CreateProjectStatusRequest("검토 중", "IN_PROGRESS", null, null));
          statusService.create(
              owner, project.key(), new CreateProjectStatusRequest("배포 대기", "DONE", null, null));
          return null;
        });
    int number = seedIssue(project, 1).number();
    List<Long> statusIds =
        callInTenant(
            1L,
            () ->
                baseDsl
                    .select(PROJECT_STATUS.ID)
                    .from(PROJECT_STATUS)
                    .where(PROJECT_STATUS.PROJECT_ID.eq(project.id()))
                    .orderBy(PROJECT_STATUS.POSITION)
                    .fetch(PROJECT_STATUS.ID));
    Set<String> names =
        new HashSet<>(
            callInTenant(
                1L,
                () ->
                    baseDsl
                        .select(PROJECT_STATUS.NAME)
                        .from(PROJECT_STATUS)
                        .where(PROJECT_STATUS.PROJECT_ID.eq(project.id()))
                        .fetch(PROJECT_STATUS.NAME)));

    int threads = 6;
    ExecutorService pool = Executors.newFixedThreadPool(threads);
    try {
      // 한 번의 경합에 기대지 않게 여러 차례 몰아 보낸다
      for (int round = 0; round < 5; round++) {
        CountDownLatch go = new CountDownLatch(1);
        List<Future<?>> calls = new ArrayList<>();
        for (int t = 0; t < threads; t++) {
          long target = statusIds.get((round + t) % statusIds.size());
          calls.add(
              pool.submit(
                  () -> {
                    go.await();
                    return callInTenant(
                        1L,
                        () ->
                            issueService.updateStatus(owner, project.key(), number, null, target));
                  }));
        }
        go.countDown();
        for (Future<?> f : calls) f.get(30, TimeUnit.SECONDS);
      }
    } finally {
      pool.shutdownNow();
      pool.awaitTermination(30, TimeUnit.SECONDS);
    }

    var history =
        callInTenant(
            1L,
            () ->
                baseDsl
                    .select(ISSUE_HISTORY.FROM_VALUE, ISSUE_HISTORY.TO_VALUE)
                    .from(ISSUE_HISTORY)
                    .join(ISSUE)
                    .on(ISSUE.ID.eq(ISSUE_HISTORY.ISSUE_ID))
                    .where(
                        ISSUE
                            .PROJECT_ID
                            .eq(project.id())
                            .and(ISSUE_HISTORY.EVENT_TYPE.eq("STATUS_CHANGED")))
                    .fetch());
    assertThat(history).isNotEmpty();
    assertThat(history.getValues(ISSUE_HISTORY.FROM_VALUE)).allMatch(names::contains);
    assertThat(history.getValues(ISSUE_HISTORY.TO_VALUE)).allMatch(names::contains);
  }

  /**
   * issueId 의 상태를 statusId 로 바꾸는 트랜잭션을 커밋 전에 멈춰 두고 read 를 별도 트랜잭션에서 시작한다. read 가 그 이슈 행 잠금을 기다리는 것을
   * 확인한 뒤 상태 변경을 커밋시키고 read 결과를 돌려준다.
   */
  private List<IssueRow> readWhileStatusChangeHeld(
      long issueId, long statusId, Supplier<List<IssueRow>> read) throws Exception {
    CountDownLatch held = new CountDownLatch(1);
    CountDownLatch release = new CountDownLatch(1);
    ExecutorService pool = Executors.newFixedThreadPool(2);
    try {
      Future<?> holder =
          pool.submit(
              () ->
                  callInTenant(
                      1L,
                      () -> {
                        baseDsl.execute(
                            "UPDATE issue SET status_id = ?, status = (SELECT category FROM"
                                + " project_status WHERE id = ?) WHERE id = ?",
                            statusId,
                            statusId,
                            issueId);
                        held.countDown();
                        RowLockWaits.awaitQuietly(release);
                        return null;
                      }));
      assertThat(held.await(10, TimeUnit.SECONDS)).as("상태 변경이 커밋 직전에 멈춤").isTrue();

      Future<List<IssueRow>> reader =
          pool.submit(
              () -> {
                TenantContext.set(1L);
                try {
                  return new TransactionTemplate(txManager).execute(s -> read.get());
                } finally {
                  TenantContext.clear();
                }
              });
      RowLockWaits.awaitLockWaiter(reader);
      release.countDown();
      holder.get(10, TimeUnit.SECONDS);
      return reader.get(10, TimeUnit.SECONDS);
    } finally {
      release.countDown();
      pool.shutdownNow();
      pool.awaitTermination(20, TimeUnit.SECONDS);
    }
  }

  /** 행의 상태 id·이름·색이 새 상태의 것이다 — 이름·색이 null(조인 누락)이 아니다. */
  private static void assertNamed(IssueRow row, long statusId, String name) {
    assertThat(row.statusId()).isEqualTo(statusId);
    assertThat(row.statusName()).isEqualTo(name);
    assertThat(row.statusColor()).isNotNull();
  }

  private ProjectResponse newProject(String prefix) {
    String key =
        prefix + UUID.randomUUID().toString().replace("-", "").toUpperCase().substring(0, 4);
    ProjectResponse p =
        projectService.create(owner, new CreateProjectRequest(key, "P", "x", "TEAM"));
    projects.add(p.id());
    return p;
  }

  private IssueRow seedIssue(ProjectResponse p, int number) {
    return callInTenant(
        1L,
        () ->
            IssueSeeds.insert(
                issueRepository, baseDsl, p.id(), number, "t" + number, null, "MID", null, owner));
  }

  private long statusId(ProjectResponse p, String name) {
    return callInTenant(
        1L,
        () ->
            baseDsl
                .select(PROJECT_STATUS.ID)
                .from(PROJECT_STATUS)
                .where(PROJECT_STATUS.PROJECT_ID.eq(p.id()).and(PROJECT_STATUS.NAME.eq(name)))
                .fetchSingle(PROJECT_STATUS.ID));
  }
}
