package com.workplace.issue.service;

import static com.workplace.jooq.Tables.AUDIT_LOG;
import static com.workplace.jooq.Tables.ISSUE;
import static com.workplace.jooq.Tables.ISSUE_CYCLE;
import static com.workplace.jooq.Tables.PROJECT;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static com.workplace.support.TestFixtures.uniqueProjectKey;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.cycle.dto.CreateCycleRequest;
import com.workplace.cycle.exception.CompletedCycleNotAssignableException;
import com.workplace.cycle.service.CycleService;
import com.workplace.global.tenant.TenantContext;
import com.workplace.issue.dto.CreateIssueRequest;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.service.ProjectService;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.PostgresTestContainer;
import com.workplace.support.RowLockWaits;
import com.workplace.support.TestFixtures;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutionException;
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
 * 이슈 만들기와 사이클 완료의 경합(WP-1945) — 만들기가 사이클 행을 잠그지 않고 요청 순서대로 issue_cycle 을 INSERT 해, 완료(작은 id → 큰 id
 * 순 FOR UPDATE)와 역순으로 겹치면 교착(40P01)이 나거나 완료된 사이클에 이슈가 붙었다.
 *
 * <p>순서를 결정적으로 맞춘다: 막는 tx(풀 밖 커넥션)가 작은 id 사이클 A 를 FOR UPDATE 로 쥔 채 → 만들기(cycleIds=[B, A])가 잠금 대기에
 * 들어선 것을 잠금 대기(pg_locks)로 확인 → 막는 tx 가 B 를 FOR UPDATE 로 잡고 A 를 COMPLETED 로 바꿔 커밋(완료의 잠금 순서와 같다).
 * 고치기 전에는 만들기가 B 를 KEY SHARE 로 쥔 채 A 를 기다려 막는 tx 의 B 잠금과 교착이었다. 커밋된 데이터라 @AfterEach 로 정리한다.
 */
class IssueCycleAttachRaceTest extends IntegrationTestBase {

  @Autowired IssueService issueService;
  @Autowired CycleService cycleService;
  @Autowired ProjectService projectService;
  @Autowired IssueCycleService issueCycleService;

  private final List<Long> users = new ArrayList<>();
  private long owner;
  private Long projectId;
  private String projectKey;

  @BeforeEach
  void seed() {
    TenantContext.set(1L);
    owner = TestFixtures.createHuman(baseDsl);
    TestFixtures.grantRole(baseDsl, owner, "USER");
    TestFixtures.addMember(baseDsl, owner, 1L);
    users.add(owner);
    projectKey = uniqueProjectKey("C");
    projectId =
        projectService
            .create(owner, new CreateProjectRequest(projectKey, "cycle attach", null))
            .id();
  }

  @AfterEach
  void cleanup() {
    cleanupInTenant(
        1L,
        () -> {
          baseDsl.deleteFrom(ISSUE).where(ISSUE.PROJECT_ID.eq(projectId)).execute();
          baseDsl.deleteFrom(PROJECT).where(PROJECT.ID.eq(projectId)).execute();
          baseDsl.deleteFrom(AUDIT_LOG).where(AUDIT_LOG.USER_ID.in(users)).execute();
        });
    baseDsl.deleteFrom(USER_ROLE).where(USER_ROLE.USER_ID.in(users)).execute();
    baseDsl.deleteFrom(USER).where(USER.ID.in(users)).execute();
    TenantContext.clear();
  }

  @Test
  void create_reverseOrderCycles_noDeadlockAndRejectsCompleted() throws Exception {
    long a = cycle("AT-A");
    long b = cycle("AT-B");
    assertThat(a).isLessThan(b);

    ExecutorService pool = Executors.newFixedThreadPool(1);
    try (Connection blocker = ownerConnection()) {
      blocker.setAutoCommit(false);
      // 막는 tx — 완료처럼 작은 id(A)를 먼저 FOR UPDATE 로 쥔다.
      lockForUpdate(blocker, a);

      Future<Object> create =
          pool.submit(
              () -> inTenant(() -> issueService.create(owner, projectKey, request(List.of(b, a)))));
      RowLockWaits.awaitLockWaiter(create);

      // 이어서 B 를 잡고 A 를 완료로 바꿔 커밋 — 5초 안에 끝나야 한다(교착이면 감지 뒤 한쪽이 40P01).
      blocker.createStatement().execute("set lock_timeout = '5s'");
      lockForUpdate(blocker, b);
      setCompleted(blocker, a);
      blocker.commit();

      assertThat(outcome(create)).isInstanceOf(CompletedCycleNotAssignableException.class);
    } finally {
      pool.shutdownNow();
      pool.awaitTermination(20, TimeUnit.SECONDS);
    }
    assertThat(callInTenant(1L, () -> baseDsl.fetchCount(ISSUE, ISSUE.PROJECT_ID.eq(projectId))))
        .isZero();
  }

  @Test
  void replace_whileCycleCompleting_rejectsCompleted() throws Exception {
    long a = cycle("RP-A");
    int number = issueNumber();
    assertCompletingCycleRejectsAttach(
        a, number, () -> issueCycleService.replace(owner, projectKey, number, List.of(a)));
  }

  @Test
  void move_whileCycleCompleting_rejectsCompleted() throws Exception {
    long a = cycle("MV-A");
    int number = issueNumber();
    assertCompletingCycleRejectsAttach(
        a, number, () -> issueCycleService.move(owner, projectKey, number, null, a));
  }

  /**
   * 막는 tx 가 사이클 A 를 FOR UPDATE 로 쥐고 COMPLETED 로 바꾼 채(커밋 전) 붙이기를 시작시켜 잠금 대기를 관측한 뒤 커밋한다. 붙이기는 커밋 뒤의
   * 상태를 읽어 거절되고 issue_cycle 에 행이 남지 않아야 한다.
   */
  private void assertCompletingCycleRejectsAttach(long cycleId, int number, Supplier<Object> attach)
      throws Exception {
    ExecutorService pool = Executors.newFixedThreadPool(1);
    try (Connection blocker = ownerConnection()) {
      blocker.setAutoCommit(false);
      completeOnBlocker(blocker, cycleId);

      Future<Object> call = pool.submit(() -> inTenant(attach));
      RowLockWaits.awaitLockWaiter(call);
      blocker.commit();

      assertThat(outcome(call)).isInstanceOf(CompletedCycleNotAssignableException.class);
    } finally {
      pool.shutdownNow();
      pool.awaitTermination(20, TimeUnit.SECONDS);
    }
    assertThat(
            callInTenant(
                1L, () -> baseDsl.fetchCount(ISSUE_CYCLE, ISSUE_CYCLE.CYCLE_ID.eq(cycleId))))
        .isZero();
  }

  private int issueNumber() {
    return issueService.create(owner, projectKey, request(List.of())).number();
  }

  /** 사이클만 지정한 최소 만들기 요청. */
  private static CreateIssueRequest request(List<Long> cycleIds) {
    return new CreateIssueRequest(
        "사이클 경합", null, "MID", null, null, null, null, null, null, null, cycleIds, null, null, null,
        null, null);
  }

  private long cycle(String name) {
    return cycleService
        .create(owner, projectKey, new CreateCycleRequest(name, null, null, null, "ACTIVE"))
        .id();
  }

  /** 막는 tx 가 사이클을 FOR UPDATE 로 쥐고 COMPLETED 로 바꾼다(커밋 전) — 완료의 잠금·쓰기 순서와 같다. */
  private static void completeOnBlocker(Connection blocker, long cycleId) throws Exception {
    lockForUpdate(blocker, cycleId);
    setCompleted(blocker, cycleId);
  }

  private static void setCompleted(Connection blocker, long cycleId) throws Exception {
    try (PreparedStatement ps =
        blocker.prepareStatement("update cycle set status = 'COMPLETED' where id = ?")) {
      ps.setLong(1, cycleId);
      assertThat(ps.executeUpdate()).isEqualTo(1);
    }
  }

  private static void lockForUpdate(Connection c, long cycleId) throws Exception {
    try (PreparedStatement ps =
        c.prepareStatement("select id from cycle where id = ? for update")) {
      ps.setLong(1, cycleId);
      assertThat(ps.executeQuery().next()).isTrue();
    }
  }

  /** 작업이 던진 예외(정상 종료면 null)를 돌려준다 — 원인 체인의 가장 안쪽이 아니라 던져진 예외 자체다. */
  private static Throwable outcome(Future<?> f) throws Exception {
    try {
      f.get(20, TimeUnit.SECONDS);
      return null;
    } catch (ExecutionException e) {
      return e.getCause();
    }
  }

  private static Connection ownerConnection() throws Exception {
    var db = PostgresTestContainer.INSTANCE;
    return DriverManager.getConnection(db.getJdbcUrl(), db.getUsername(), db.getPassword());
  }

  /** 테넌트 1 트랜잭션에서 본문을 실행한다. */
  private <T> T inTenant(Supplier<T> body) {
    TenantContext.set(1L);
    try {
      return new TransactionTemplate(txManager).execute(s -> body.get());
    } finally {
      TenantContext.clear();
    }
  }
}
