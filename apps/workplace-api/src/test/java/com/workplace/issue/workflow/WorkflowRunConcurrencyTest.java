package com.workplace.issue.workflow;

import static com.workplace.jooq.Tables.AUDIT_LOG;
import static com.workplace.jooq.Tables.ISSUE;
import static com.workplace.jooq.Tables.ISSUE_ASSIGNEE;
import static com.workplace.jooq.Tables.NODE_RUN;
import static com.workplace.jooq.Tables.PROJECT;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.WORKFLOW_RUN;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.issue.repository.IssueRepository;
import com.workplace.issue.service.IssueTypeService;
import com.workplace.issue.service.OpenScenario;
import com.workplace.issue.workflow.dto.CreateWorkflowRequest;
import com.workplace.issue.workflow.dto.MoveRequest;
import com.workplace.issue.workflow.dto.UpdateWorkflowRequest;
import com.workplace.issue.workflow.exception.WorkflowException;
import com.workplace.issue.workflow.service.WorkflowDefinitionService;
import com.workplace.issue.workflow.service.WorkflowRunService;
import com.workplace.project.repository.ProjectIssueSequenceRepository;
import com.workplace.project.repository.ProjectMemberRepository;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.PostgresTestContainer;
import java.sql.Connection;
import java.sql.DriverManager;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.locks.LockSupport;
import java.util.function.Supplier;
import org.jooq.DSLContext;
import org.jooq.SQLDialect;
import org.jooq.impl.DSL;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import tools.jackson.databind.ObjectMapper;

/**
 * WP-1985 실행 시작·이동의 경합 — {@code WorkflowPublishRaceTest} 방식으로 커밋되는 트랜잭션끼리 실제로 겹친다(테스트 트랜잭션 없음, 자기
 * 행만 정리).
 *
 * <p>풀 밖 접속(소유자 롤 + 테넌트 1 GUC)이 이슈 행을 먼저 잠그고, 함께 출발한 두 요청이 <b>모두 그 잠금에 걸린 것을 확인한 뒤</b> 놓는다 — 그래서 이슈
 * 행 잠금을 빼면 두 요청이 같은 revision 을 보고 둘 다 넘기거나 같은 key 를 두 번 처리해 매번 실패한다. 시험 풀은 연결이 2개뿐이라 두 요청에게 다 준다.
 */
class WorkflowRunConcurrencyTest extends IntegrationTestBase {

  private static final long LIMIT_SECONDS = 30;

  /** 이 트랜잭션에 (줄줄이) 막힌 다른 연결의 수. */
  private static final String BLOCKED_BY_ME =
      """
      WITH RECURSIVE waiting AS MATERIALIZED (
        SELECT DISTINCT pid FROM pg_locks WHERE NOT granted
      ), chain(pid) AS (
        SELECT pg_backend_pid()
        UNION
        SELECT w.pid FROM waiting w JOIN chain c ON c.pid = ANY(pg_blocking_pids(w.pid))
      )
      SELECT count(*) - 1 FROM chain
      """;

  @Autowired WorkflowRunService runService;
  @Autowired WorkflowDefinitionService definitionService;
  @Autowired IssueTypeService issueTypeService;
  @Autowired IssueRepository issueRepository;
  @Autowired ProjectIssueSequenceRepository sequenceRepository;
  @Autowired ProjectMemberRepository projectMemberRepository;
  @Autowired ObjectMapper om;

  private OpenScenario.Result s;
  private long a;
  private long b;
  private long workflowId;

  /** 커밋된 프로젝트·두 담당(같은 역할)·게시하고 켠 정의·두 사람이 담당인 이슈. */
  @BeforeEach
  void seed() {
    s =
        callInTenant(
            1L,
            () ->
                OpenScenario.createTeam(
                    baseDsl, issueTypeService, issueRepository, sequenceRepository, 1L));
    callInTenant(
        1L,
        () -> {
          for (long id : List.of(s.ownerId(), s.memberId())) {
            withMembership(id);
            grantUserRole(id);
          }
          return null;
        });
    a = s.ownerId();
    b = s.memberId();
    String yaml =
        """
        schema: genia/workflow@1
        name: 경합
        roles:
          owner: { members: ["%s", "%s"] }
        nodes:
          start: { type: start }
          work: { type: human_task, role: owner, outcomes: { done: { to: work2 } } }
          work2: { type: human_task, role: owner, outcomes: { done: { to: end } } }
          end: { type: end }
        start:
          - { when: { assigneeRole: owner }, to: work }
        """
            .formatted(username(a), username(b));
    workflowId =
        callInTenant(
            1L,
            () -> {
              long id =
                  definitionService
                      .create(s.project().id(), new CreateWorkflowRequest("경합", yaml), a)
                      .id();
              definitionService.publish(id, null, false, a);
              definitionService.update(id, new UpdateWorkflowRequest(true, null), a);
              baseDsl
                  .insertInto(ISSUE_ASSIGNEE)
                  .set(ISSUE_ASSIGNEE.ISSUE_ID, s.issueId())
                  .set(ISSUE_ASSIGNEE.USER_ID, a)
                  .set(ISSUE_ASSIGNEE.ASSIGNED_BY, a)
                  .execute();
              baseDsl
                  .insertInto(ISSUE_ASSIGNEE)
                  .set(ISSUE_ASSIGNEE.ISSUE_ID, s.issueId())
                  .set(ISSUE_ASSIGNEE.USER_ID, b)
                  .set(ISSUE_ASSIGNEE.ASSIGNED_BY, a)
                  .execute();
              return id;
            });
  }

  /** 이 시험이 만든 행만 치운다 — 실행은 이슈와 함께 지워지고(CASCADE), 그 뒤 프로젝트·사용자. */
  @AfterEach
  void cleanup() {
    if (s == null) {
      return;
    }
    cleanupInTenant(
        1L,
        () -> {
          baseDsl.deleteFrom(WORKFLOW_RUN).where(WORKFLOW_RUN.ISSUE_ID.eq(s.issueId())).execute();
          baseDsl.deleteFrom(ISSUE).where(ISSUE.PROJECT_ID.eq(s.project().id())).execute();
          baseDsl.deleteFrom(PROJECT).where(PROJECT.ID.eq(s.project().id())).execute();
          List<Long> users = List.of(s.ownerId(), s.memberId(), s.reporterId(), s.strangerId());
          baseDsl.deleteFrom(AUDIT_LOG).where(AUDIT_LOG.USER_ID.in(users)).execute();
          baseDsl.deleteFrom(USER).where(USER.ID.in(users)).execute();
        });
  }

  @Test
  @DisplayName("두 담당이 같은 revision·다른 key 로 동시에 넘기면 하나만 200, 하나는 409 STALE 이고 node_run 은 한 줄만 는다")
  void concurrentMove_onlyOneSucceeds() throws Exception {
    start(a);
    int before = nodeRuns();

    List<String> results =
        race(
            List.of(
                () -> codeWithRevision(() -> move(a, "ka")),
                () -> codeWithRevision(() -> move(b, "kb"))));

    // 진 쪽 STALE 은 늘어난 지금 값(이긴 이동 뒤 노드·revision 1)을 실어 다시 읽지 않고도 고쳐 보낼 수 있다.
    assertThat(results).containsExactlyInAnyOrder("OK", "WORKFLOW_STALE@work2#1");
    assertThat(nodeRuns()).isEqualTo(before + 1);
    assertThat(revision()).isEqualTo(1);
  }

  @Test
  @DisplayName("같은 사람이 같은 key 로 동시에 두 번 보내면 본문이 같고 revision 은 한 번만 는다")
  void sameIdempotencyKey_returnsFirstResult() throws Exception {
    start(a);

    List<String> bodies =
        race(
            List.of(
                () -> om.writeValueAsString(move(a, "same")),
                () -> om.writeValueAsString(move(a, "same"))));

    assertThat(om.readTree(bodies.get(0))).isEqualTo(om.readTree(bodies.get(1)));
    assertThat(revision()).isEqualTo(1);
  }

  @Test
  @DisplayName("동시에 시작하면 하나만 활성 실행이 되고 하나는 409 WORKFLOW_ALREADY_ACTIVE")
  void concurrentStart_onlyOneActive() throws Exception {
    List<String> results = race(List.of(() -> code(() -> start(a)), () -> code(() -> start(b))));

    assertThat(results).containsExactlyInAnyOrder("OK", "WORKFLOW_ALREADY_ACTIVE");
    assertThat(
            callInTenant(
                1L, () -> baseDsl.fetchCount(WORKFLOW_RUN, WORKFLOW_RUN.ISSUE_ID.eq(s.issueId()))))
        .isEqualTo(1);
  }

  // ───────────────────────── 도우미 ─────────────────────────

  private Object start(long actor) {
    return callInTenant(1L, () -> runService.start(s.issueId(), workflowId, false, actor));
  }

  private Object move(long actor, String key) {
    return callInTenant(
        1L,
        () ->
            runService.move(
                s.issueId(), new MoveRequest("work", "done", null, null, null, 0, key), actor));
  }

  /** 자기 트랜잭션으로 부르고 워크플로우 거절만 코드로 바꾼다. */
  private static String code(Supplier<?> call) {
    try {
      call.get();
      return "OK";
    } catch (WorkflowException e) {
      return e.code();
    }
  }

  /** {@link #code} 에 STALE 이면 errors 의 currentNode·revision 을 붙인다(R29 — 옛 값이 아닌 지금 값인지 본다). */
  private static String codeWithRevision(Supplier<?> call) {
    try {
      call.get();
      return "OK";
    } catch (WorkflowException e) {
      return e.code() + "@" + e.details().get("currentNode") + "#" + e.details().get("revision");
    }
  }

  private String username(long id) {
    return callInTenant(
        1L,
        () ->
            baseDsl.select(USER.USERNAME).from(USER).where(USER.ID.eq(id)).fetchSingle().value1());
  }

  private int nodeRuns() {
    return callInTenant(
        1L,
        () ->
            baseDsl.fetchCount(
                NODE_RUN,
                NODE_RUN.RUN_ID.in(
                    baseDsl
                        .select(WORKFLOW_RUN.ID)
                        .from(WORKFLOW_RUN)
                        .where(WORKFLOW_RUN.ISSUE_ID.eq(s.issueId())))));
  }

  private int revision() {
    return callInTenant(
        1L,
        () ->
            baseDsl
                .select(WORKFLOW_RUN.REVISION)
                .from(WORKFLOW_RUN)
                .where(WORKFLOW_RUN.ISSUE_ID.eq(s.issueId()))
                .fetchSingle()
                .value1());
  }

  /**
   * 풀 밖 트랜잭션이 이슈 행을 FOR NO KEY UPDATE 로 잠근 동안 {@code calls} 를 동시에 출발시키고, 모두 막힌 것을 확인한 뒤 커밋해 놓는다.
   */
  private <T> List<T> race(List<Supplier<T>> calls) throws Exception {
    var db = PostgresTestContainer.INSTANCE;
    ExecutorService pool = Executors.newFixedThreadPool(calls.size());
    try {
      List<Future<T>> futures = new ArrayList<>();
      try (Connection c =
          DriverManager.getConnection(db.getJdbcUrl(), db.getUsername(), db.getPassword())) {
        c.setAutoCommit(false);
        DSLContext holder = DSL.using(c, SQLDialect.POSTGRES);
        holder.execute("SELECT set_config('app.tenant_id', '1', true)");
        holder
            .select(ISSUE.ID)
            .from(ISSUE)
            .where(ISSUE.ID.eq(s.issueId()))
            .forNoKeyUpdate()
            .fetch();
        CountDownLatch go = new CountDownLatch(1);
        for (Supplier<T> call : calls) {
          futures.add(
              pool.submit(
                  () -> {
                    if (!go.await(LIMIT_SECONDS, TimeUnit.SECONDS)) {
                      throw new IllegalStateException("출발 신호가 오지 않았다");
                    }
                    return call.get();
                  }));
        }
        go.countDown();
        awaitAllBlocked(holder, futures);
        c.commit();
      }
      List<T> results = new ArrayList<>();
      for (Future<T> f : futures) {
        results.add(f.get(LIMIT_SECONDS, TimeUnit.SECONDS));
      }
      return results;
    } finally {
      pool.shutdownNow();
      assertThat(pool.awaitTermination(LIMIT_SECONDS, TimeUnit.SECONDS)).isTrue();
    }
  }

  /** 막는 트랜잭션 안에서, 모든 요청이 잠금을 기다릴 때까지 본다. */
  private static <T> void awaitAllBlocked(DSLContext holder, List<Future<T>> futures) {
    long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(LIMIT_SECONDS);
    while (((Number) holder.fetchValue(BLOCKED_BY_ME)).intValue() < futures.size()) {
      for (Future<T> f : futures) {
        if (f.isDone()) {
          throw new AssertionError("잠금을 기다리지 않고 끝났다", failureOf(f));
        }
      }
      if (System.nanoTime() > deadline) {
        throw new AssertionError("요청들이 잠금에 걸리지 않았다");
      }
      LockSupport.parkNanos(TimeUnit.MILLISECONDS.toNanos(20));
    }
  }

  private static Throwable failureOf(Future<?> done) {
    try {
      done.get();
      return null;
    } catch (ExecutionException e) {
      return e.getCause();
    } catch (InterruptedException e) {
      Thread.currentThread().interrupt();
      return e;
    }
  }
}
