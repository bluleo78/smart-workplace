package com.workplace.issue.workflow;

import static com.workplace.jooq.Tables.AUDIT_LOG;
import static com.workplace.jooq.Tables.PROJECT;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.support.TestFixtures.uniqueProjectKey;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.issue.workflow.dto.CreateWorkflowRequest;
import com.workplace.issue.workflow.dto.SaveWorkflowDraftRequest;
import com.workplace.issue.workflow.dto.UpdateWorkflowRequest;
import com.workplace.issue.workflow.exception.WorkflowException;
import com.workplace.issue.workflow.repository.WorkflowRepository;
import com.workplace.issue.workflow.repository.WorkflowRow;
import com.workplace.issue.workflow.repository.WorkflowVersionSummaryRow;
import com.workplace.issue.workflow.service.WorkflowDefinitionService;
import com.workplace.project.repository.ProjectMemberRepository;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.PostgresTestContainer;
import com.workplace.support.TestFixtures;
import java.sql.Connection;
import java.sql.DriverManager;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.locks.LockSupport;
import java.util.function.Consumer;
import java.util.function.Supplier;
import org.jooq.DSLContext;
import org.jooq.SQLDialect;
import org.jooq.impl.DSL;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

/**
 * WP-1984 워크플로우 쓰기의 경합 — 커밋되는 트랜잭션으로 실제로 겹친다(테스트 트랜잭션 없음, 자기 행만 정리).
 *
 * <p>운에 맡기지 않으려고 막는 트랜잭션이 먼저 잠금을 쥐고, 함께 출발한 요청들이 <b>모두 DB 잠금에 걸린 것을 확인한 뒤</b> 놓는다. 그래서 잠금을 빼거나 잠그기
 * 전에 읽은 값을 쓰면 매번 실패한다. 기다림의 상한은 멈춤 방지용일 뿐 시간 단언이 아니다. 시험 풀은 연결이 2개뿐이라 두 요청에게 다 주고, 막는 트랜잭션은 풀 밖의
 * 접속(소유자 롤 + 테넌트 1 GUC)으로 연다.
 */
class WorkflowPublishRaceTest extends IntegrationTestBase {

  private static final long LIMIT_SECONDS = 30;

  /** 이 트랜잭션에 (줄줄이) 막힌 다른 연결의 수. pg_locks 는 트랜잭션 안에서도 매번 지금 값을 보여 준다. */
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

  @Autowired WorkflowDefinitionService service;
  @Autowired WorkflowRepository repo;
  @Autowired ProjectMemberRepository projectMemberRepository;

  private Long projectId;
  private Long ownerId;
  private String yaml;

  /** 커밋된 OWNER·프로젝트와 게시할 수 있는 YAML(경합은 다른 트랜잭션이 봐야 한다). */
  @BeforeEach
  void seed() {
    ownerId = callInTenant(1L, () -> withMembership(TestFixtures.createHuman(baseDsl)));
    projectId =
        callInTenant(
            1L,
            () -> {
              long id =
                  baseDsl
                      .insertInto(PROJECT)
                      .set(PROJECT.KEY, uniqueProjectKey("WR"))
                      .set(PROJECT.NAME, "workflow race test")
                      .set(PROJECT.OWNER_ID, ownerId)
                      .returning(PROJECT.ID)
                      .fetchSingle()
                      .getId();
              projectMemberRepository.insert(id, ownerId, "OWNER");
              return id;
            });
    String username =
        callInTenant(
            1L,
            () ->
                baseDsl
                    .select(USER.USERNAME)
                    .from(USER)
                    .where(USER.ID.eq(ownerId))
                    .fetchSingle()
                    .value1());
    yaml =
        """
        schema: genia/workflow@1
        name: 경합
        roles:
          owner: { members: ["%s"] }
        nodes:
          start: { type: start }
          work: { type: human_task, role: owner, outcomes: { done: { to: end } } }
          end: { type: end }
        start:
          - { when: { assigneeRole: owner }, to: work }
        """
            .formatted(username);
  }

  /** 성공·실패와 상관없이 이 시험이 만든 행만 치운다. */
  @AfterEach
  void cleanup() {
    if (ownerId == null) {
      return;
    }
    cleanupInTenant(
        1L,
        () -> {
          // workflow·workflow_version·project_member 는 프로젝트 삭제에 따라 지워진다.
          if (projectId != null) {
            baseDsl.deleteFrom(PROJECT).where(PROJECT.ID.eq(projectId)).execute();
          }
          baseDsl.deleteFrom(AUDIT_LOG).where(AUDIT_LOG.USER_ID.eq(ownerId)).execute();
          baseDsl.deleteFrom(USER).where(USER.ID.eq(ownerId)).execute();
        });
  }

  @Test
  @DisplayName("동시에 게시해도 둘 다 성공하고 번호는 정확히 1 과 2")
  void concurrentPublish_distinctVersions() throws Exception {
    long id = seedWorkflow("게시 경합");

    List<Integer> numbers =
        race(
            held -> held.lockById(id).orElseThrow(), List.of(() -> publish(id), () -> publish(id)));

    assertThat(numbers).containsExactlyInAnyOrder(1, 2);
    List<WorkflowVersionSummaryRow> versions = callInTenant(1L, () -> repo.findVersions(id));
    assertThat(versions).extracting(WorkflowVersionSummaryRow::versionNo).containsExactly(2, 1);
    assertThat(row(id).activeVersionId()).isEqualTo(versions.get(0).id());
  }

  @Test
  @DisplayName("같은 시각을 보고 동시에 저장하면 하나만 저장되고 하나는 409")
  void concurrentSave_sameExpected_oneConflict() throws Exception {
    long id = seedWorkflow("저장 경합");
    Instant seen = row(id).draftUpdatedAt();

    List<String> results =
        race(
            held -> held.lockById(id).orElseThrow(),
            List.of(() -> save(id, yaml + "# 하나\n", seen), () -> save(id, yaml + "# 둘\n", seen)));

    assertThat(results).containsExactlyInAnyOrder("OK", "WORKFLOW_DRAFT_CONFLICT");
  }

  @Test
  @DisplayName("게시는 잠그기 전에 읽은 초안이 아니라 잠근 뒤의 초안을 게시한다")
  void publish_usesDraftReadUnderLock() throws Exception {
    long id = seedWorkflow("초안 경합");
    String changed = yaml + "# 먼저 저장됨\n";
    Instant later = row(id).draftUpdatedAt().plus(1, ChronoUnit.SECONDS);

    List<Integer> numbers =
        race(
            held -> {
              held.lockById(id).orElseThrow();
              held.updateDraft(id, changed, ownerId, later);
            },
            List.of(() -> publish(id)));

    assertThat(numbers).containsExactly(1);
    assertThat(callInTenant(1L, () -> repo.findVersion(id, 1)).orElseThrow().sourceYaml())
        .isEqualTo(changed);
  }

  @Test
  @DisplayName("되돌리기의 충돌 검사는 잠그기 전이 아니라 잠근 뒤의 초안 시각으로 한다")
  void restoreDraft_conflictCheckedUnderLock() throws Exception {
    long id = seedWorkflow("되돌리기 경합");
    publish(id);
    Instant seen = row(id).draftUpdatedAt();
    String changed = yaml + "# 남이 먼저 저장\n";

    List<String> results =
        race(
            held -> {
              held.lockById(id).orElseThrow();
              held.updateDraft(id, changed, ownerId, seen.plus(1, ChronoUnit.SECONDS));
            },
            List.of(() -> codeOf(() -> service.restoreDraft(id, 1, seen, ownerId))));

    assertThat(results).containsExactly("WORKFLOW_DRAFT_CONFLICT");
    assertThat(row(id).draftYaml()).isEqualTo(changed);
  }

  @Test
  @DisplayName("사전 검사를 지나 유일 색인에서 부딪힌 만들기도 WORKFLOW_NAME_TAKEN")
  void concurrentCreate_sameName_nameTaken() throws Exception {
    List<String> results =
        race(
            held -> held.insert(projectId, "같은 이름 a", yaml, ownerId, Instant.now()),
            List.of(
                () ->
                    codeOf(
                        () ->
                            service.create(
                                projectId, new CreateWorkflowRequest("같은 이름 A", yaml), ownerId))));

    assertThat(results).containsExactly("WORKFLOW_NAME_TAKEN");
  }

  @Test
  @DisplayName("사전 검사를 지나 유일 색인에서 부딪힌 이름 바꾸기도 WORKFLOW_NAME_TAKEN")
  void concurrentRename_sameName_nameTaken() throws Exception {
    long id = seedWorkflow("바꾸기 전");

    List<String> results =
        race(
            held -> held.insert(projectId, "같은 이름 b", yaml, ownerId, Instant.now()),
            List.of(
                () ->
                    codeOf(
                        () ->
                            service.update(
                                id, new UpdateWorkflowRequest(null, "같은 이름 B"), ownerId))));

    assertThat(results).containsExactly("WORKFLOW_NAME_TAKEN");
    assertThat(row(id).name()).isEqualTo("바꾸기 전");
  }

  /** 커밋된 초안 하나. */
  private long seedWorkflow(String name) {
    return callInTenant(
        1L,
        () ->
            repo.insert(
                projectId, name, yaml, ownerId, Instant.now().truncatedTo(ChronoUnit.MILLIS)));
  }

  /** 커밋된 지금의 행. */
  private WorkflowRow row(long id) {
    return callInTenant(1L, () -> repo.findById(id)).orElseThrow();
  }

  /** 자기 TenantContext·트랜잭션으로 게시한다 — 어떤 예외도 잡지 않는다. */
  private int publish(long id) {
    return callInTenant(1L, () -> service.publish(id, null, false, ownerId).versionNo());
  }

  /** 초안 저장의 결과를 글로 — 충돌 외 예외는 그대로 던진다. */
  private String save(long id, String text, Instant seen) {
    return codeOf(() -> service.saveDraft(id, new SaveWorkflowDraftRequest(text, seen), ownerId));
  }

  /** 자기 트랜잭션으로 부르고 워크플로우 거절만 코드로 바꾼다(DuplicateKey 등은 시험 실패가 된다). */
  private String codeOf(Supplier<?> call) {
    try {
      callInTenant(1L, call);
      return "OK";
    } catch (WorkflowException e) {
      return e.code();
    }
  }

  /**
   * {@code hold} 가 잠금을 쥔 풀 밖 트랜잭션 동안 {@code calls}(각자 자기 TenantContext·트랜잭션)를 동시에 출발시키고, 모두 막힌 것을
   * 확인한 뒤 커밋해 놓는다. 어느 쪽 예외든 잡아 넘기지 않는다.
   */
  private <T> List<T> race(Consumer<WorkflowRepository> hold, List<Supplier<T>> calls)
      throws Exception {
    var db = PostgresTestContainer.INSTANCE;
    ExecutorService pool = Executors.newFixedThreadPool(calls.size());
    try {
      List<Future<T>> futures = new ArrayList<>();
      try (Connection c =
          DriverManager.getConnection(db.getJdbcUrl(), db.getUsername(), db.getPassword())) {
        c.setAutoCommit(false);
        DSLContext holder = DSL.using(c, SQLDialect.POSTGRES);
        holder.execute("SELECT set_config('app.tenant_id', '1', true)");
        hold.accept(new WorkflowRepository(holder));
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

  /** 먼저 끝난 요청의 실패 원인(성공이면 null). */
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
