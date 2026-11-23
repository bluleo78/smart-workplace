package com.workplace.issue.workflow;

import static com.workplace.jooq.Tables.ISSUE;
import static com.workplace.jooq.Tables.ISSUE_TYPE_DEF;
import static com.workplace.jooq.Tables.NODE_RUN;
import static com.workplace.jooq.Tables.PROJECT;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.WORKFLOW_MOVE_IDEMPOTENCY;
import static com.workplace.jooq.Tables.WORKFLOW_RUN;
import static com.workplace.jooq.Tables.WORKFLOW_RUN_EVENT;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.issue.workflow.repository.IdempotentRow;
import com.workplace.issue.workflow.repository.NodeRunRow;
import com.workplace.issue.workflow.repository.RunRow;
import com.workplace.issue.workflow.repository.WorkflowRepository;
import com.workplace.issue.workflow.repository.WorkflowRunRepository;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

/**
 * WP-1985 워크플로우 실행 저장소 통합 시험. 커밋된 행으로 시험하고 만든 프로젝트(이슈·정의·실행은 CASCADE)·사용자를 {@link #cleanup()} 이
 * 지운다.
 */
class WorkflowRunRepositoryTest extends IntegrationTestBase {

  @Autowired WorkflowRunRepository runs;
  @Autowired WorkflowRepository defs;

  private static final Instant AT = Instant.parse("2026-11-23T01:02:03.456Z");

  /** 시험이 만든 (테넌트, 프로젝트) 와 사용자 — 끝에서 지운다. */
  private final List<long[]> projects = new ArrayList<>();

  private final List<Long> users = new ArrayList<>();

  @AfterEach
  void cleanup() {
    for (long[] p : projects) {
      cleanupInTenant(
          p[0],
          () -> {
            baseDsl.deleteFrom(ISSUE).where(ISSUE.PROJECT_ID.eq(p[1])).execute();
            baseDsl.deleteFrom(PROJECT).where(PROJECT.ID.eq(p[1])).execute();
          });
    }
    for (Long u : users) {
      cleanupInTenant(1L, () -> baseDsl.deleteFrom(USER).where(USER.ID.eq(u)).execute());
    }
  }

  private long newUser() {
    long id = callInTenant(1L, () -> TestFixtures.createHuman(baseDsl));
    users.add(id);
    return id;
  }

  /** 테넌트에 프로젝트·정의·게시 버전을 만들고 (versionId, 이슈 만드는 함수에 쓸 projectId) 를 돌려준다. */
  private long[] newVersion(long tenantId, long actor) {
    return callInTenant(
        tenantId,
        () -> {
          long project =
              baseDsl
                  .insertInto(PROJECT)
                  .set(PROJECT.KEY, "WR" + (System.nanoTime() % 10_000_000))
                  .set(PROJECT.NAME, "workflow run repo test")
                  .set(PROJECT.OWNER_ID, actor)
                  .returning(PROJECT.ID)
                  .fetchOne()
                  .getId();
          projects.add(new long[] {tenantId, project});
          long wf = defs.insert(project, "wf", "y", actor, AT);
          long version = defs.insertVersion(wf, "y", "{}", actor).id();
          return new long[] {version, project, wf};
        });
  }

  private long newIssue(long tenantId, long project, long actor, int number) {
    return callInTenant(
        tenantId,
        () -> {
          Long type =
              baseDsl
                  .select(ISSUE_TYPE_DEF.ID)
                  .from(ISSUE_TYPE_DEF)
                  .where(ISSUE_TYPE_DEF.PROJECT_ID.eq(project))
                  .limit(1)
                  .fetchOne(ISSUE_TYPE_DEF.ID);
          if (type == null) {
            type =
                baseDsl
                    .insertInto(ISSUE_TYPE_DEF)
                    .set(ISSUE_TYPE_DEF.PROJECT_ID, project)
                    .set(ISSUE_TYPE_DEF.NAME, "TASK")
                    .set(ISSUE_TYPE_DEF.COLOR_TOKEN, "BLUE")
                    .set(ISSUE_TYPE_DEF.ICON, "Circle")
                    .returning(ISSUE_TYPE_DEF.ID)
                    .fetchOne()
                    .getId();
          }
          return baseDsl
              .insertInto(ISSUE)
              .set(ISSUE.PROJECT_ID, project)
              .set(ISSUE.STATUS_ID, TestFixtures.defaultStatusId(project, "TODO"))
              .set(ISSUE.NUMBER, number)
              .set(ISSUE.TITLE, "i" + number)
              .set(ISSUE.REPORTER_ID, actor)
              .set(ISSUE.TYPE_ID, type)
              .returning(ISSUE.ID)
              .fetchOne()
              .getId();
        });
  }

  private RunRow start(long tenantId, long issue, long version, long actor) {
    return callInTenant(
            tenantId, () -> runs.insertRun(issue, version, "RUNNING", "n1", "{}", actor, AT))
        .orElseThrow();
  }

  @Test
  @DisplayName("활성 실행은 이슈당 하나 — 두 번째는 empty, 끝나면 다시 시작할 수 있다")
  void insertRun_secondActive_isEmpty() {
    long actor = newUser();
    long[] v = newVersion(1L, actor);
    long issue = newIssue(1L, v[1], actor, 1);

    RunRow first = start(1L, issue, v[0], actor);
    assertThat(first.revision()).isZero();
    assertThat(first.status()).isEqualTo("RUNNING");
    assertThat(first.contextJson()).isEqualTo("{}");
    assertThat(first.startedAt()).isEqualTo(AT);
    assertThat(
            callInTenant(1L, () -> runs.insertRun(issue, v[0], "RUNNING", "n1", "{}", actor, AT)))
        .isEmpty();

    assertThat(
            callInTenant(
                1L, () -> runs.compareAndAdvance(first.id(), 0, "COMPLETED", null, "{}", AT)))
        .isTrue();
    assertThat(callInTenant(1L, () -> runs.findActiveByIssue(issue))).isEmpty();
    assertThat(callInTenant(1L, () -> runs.findCurrentByIssue(issue)).orElseThrow().id())
        .isEqualTo(first.id());
    RunRow third = start(1L, issue, v[0], actor);
    assertThat(callInTenant(1L, () -> runs.findActiveByIssue(issue)).orElseThrow().id())
        .isEqualTo(third.id());
    assertThat(callInTenant(1L, () -> runs.findCurrentByIssue(issue)).orElseThrow().id())
        .isEqualTo(third.id());
    assertThat(callInTenant(1L, () -> runs.countActiveByVersion(v[2]))).isEqualTo(Map.of(v[0], 1));
  }

  @Test
  @DisplayName("낡은 revision 으로는 갱신되지 않고 행도 그대로다")
  void compareAndAdvance_staleRevision_false_andUnchanged() {
    long actor = newUser();
    long[] v = newVersion(1L, actor);
    long issue = newIssue(1L, v[1], actor, 1);
    RunRow run = start(1L, issue, v[0], actor);

    assertThat(
            callInTenant(
                1L, () -> runs.compareAndAdvance(run.id(), 0, "WAITING", "n2", "{\"a\":1}", null)))
        .isTrue();
    RunRow after = callInTenant(1L, () -> runs.findRun(run.id())).orElseThrow();
    assertThat(after.revision()).isEqualTo(1);
    assertThat(after.status()).isEqualTo("WAITING");
    assertThat(after.currentNode()).isEqualTo("n2");

    assertThat(
            callInTenant(
                1L, () -> runs.compareAndAdvance(run.id(), 0, "RUNNING", "n9", "{\"b\":2}", null)))
        .isFalse();
    RunRow still = callInTenant(1L, () -> runs.findRun(run.id())).orElseThrow();
    assertThat(still.revision()).isEqualTo(1);
    assertThat(still.status()).isEqualTo("WAITING");
    assertThat(still.currentNode()).isEqualTo("n2");
    assertThat(still.contextJson()).contains("\"a\"").doesNotContain("\"b\"");
  }

  @Test
  @DisplayName("노드 방문의 배열은 순서·빈 배열 그대로 오가고 완료 정보가 채워진다")
  void nodeRun_arraysRoundTrip() {
    long actor = newUser();
    long[] v = newVersion(1L, actor);
    long issue = newIssue(1L, v[1], actor, 1);
    RunRow run = start(1L, issue, v[0], actor);

    NodeRunRow n =
        callInTenant(
            1L,
            () ->
                runs.insertNodeRun(
                    run.id(), "n1", 1, "ACTIVE", List.of(3L, 1L), List.of(), false, AT));
    assertThat(n.assigneeIds()).containsExactly(3L, 1L);
    assertThat(n.workflowAssignedIds()).isEmpty();
    assertThat(n.viaReturn()).isFalse();
    assertThat(n.leftAt()).isNull();

    callInTenant(
        1L,
        () -> {
          runs.completeNodeRun(
              n.id(), "COMPLETED", "approve", "{\"k\":\"v\"}", null, null, actor, AT);
          return null;
        });
    NodeRunRow done = callInTenant(1L, () -> runs.findNodeRuns(run.id())).get(0);
    assertThat(done.status()).isEqualTo("COMPLETED");
    assertThat(done.outcome()).isEqualTo("approve");
    assertThat(done.outputsJson()).contains("\"k\"");
    assertThat(done.actorId()).isEqualTo(actor);
    assertThat(done.leftAt()).isEqualTo(AT);
    assertThat(done.assigneeIds()).containsExactly(3L, 1L);

    NodeRunRow second =
        callInTenant(
            1L,
            () ->
                runs.insertNodeRun(run.id(), "n1", 2, "ACTIVE", List.of(), List.of(7L), true, AT));
    assertThat(second.assigneeIds()).isEmpty();
    assertThat(second.workflowAssignedIds()).containsExactly(7L);
    assertThat(second.viaReturn()).isTrue();
    assertThat(callInTenant(1L, () -> runs.findNodeRuns(run.id())))
        .extracting(NodeRunRow::visitNo)
        .containsExactly(1, 2);
  }

  @Test
  @DisplayName("실패로 닫은 노드 방문은 error 메시지가 저장되고 읽힌다")
  void completeNodeRun_failedWithError_roundTrips() {
    long actor = newUser();
    long[] v = newVersion(1L, actor);
    RunRow run = start(1L, newIssue(1L, v[1], actor, 1), v[0], actor);
    NodeRunRow n =
        callInTenant(
            1L,
            () -> runs.insertNodeRun(run.id(), "n1", 1, "ACTIVE", List.of(), List.of(), false, AT));
    assertThat(n.error()).isNull();

    callInTenant(
        1L,
        () -> {
          runs.completeNodeRun(
              n.id(), "FAILED", null, null, null, "자동 이동 한도(20단계)를 넘었습니다", null, AT);
          return null;
        });
    NodeRunRow failed = callInTenant(1L, () -> runs.findNodeRuns(run.id())).get(0);
    assertThat(failed.status()).isEqualTo("FAILED");
    assertThat(failed.error()).isEqualTo("자동 이동 한도(20단계)를 넘었습니다");
    assertThat(failed.outcome()).isNull();
    assertThat(failed.leftAt()).isEqualTo(AT);
  }

  @Test
  @DisplayName("들어가자마자 닫힌 방문은 한 번의 쓰기로 입·출 시각이 같고 결과·출력·행위자는 비어 있다")
  void insertClosedNodeRun_writesClosedRow() {
    long actor = newUser();
    long[] v = newVersion(1L, actor);
    RunRow run = start(1L, newIssue(1L, v[1], actor, 1), v[0], actor);

    callInTenant(
        1L,
        () -> {
          runs.insertClosedNodeRun(
              run.id(), "d1", 1, "COMPLETED", List.of(), List.of(), false, null, AT);
          runs.insertClosedNodeRun(
              run.id(), "d2", 1, "FAILED", List.of(4L), List.of(4L), true, "멈춤", AT);
          return null;
        });
    List<NodeRunRow> rows = callInTenant(1L, () -> runs.findNodeRuns(run.id()));
    NodeRunRow passed = rows.get(0);
    assertThat(passed.status()).isEqualTo("COMPLETED");
    assertThat(passed.enteredAt()).isEqualTo(AT);
    assertThat(passed.leftAt()).isEqualTo(AT);
    assertThat(passed.outcome()).isNull();
    assertThat(passed.outputsJson()).isNull();
    assertThat(passed.commentId()).isNull();
    assertThat(passed.actorId()).isNull();
    assertThat(passed.error()).isNull();
    assertThat(passed.viaReturn()).isFalse();
    NodeRunRow failed = rows.get(1);
    assertThat(failed.status()).isEqualTo("FAILED");
    assertThat(failed.error()).isEqualTo("멈춤");
    assertThat(failed.assigneeIds()).containsExactly(4L);
    assertThat(failed.workflowAssignedIds()).containsExactly(4L);
    assertThat(failed.viaReturn()).isTrue();
    assertThat(failed.leftAt()).isEqualTo(AT);
  }

  @Test
  @DisplayName("멱등 응답은 실행별로 따로이고 같은 key 의 두 번째 저장은 무시된다")
  void idempotency_perRun() {
    long actor = newUser();
    long other = newUser();
    long[] v = newVersion(1L, actor);
    long i1 = newIssue(1L, v[1], actor, 1);
    long i2 = newIssue(1L, v[1], actor, 2);
    RunRow r1 = start(1L, i1, v[0], actor);
    RunRow r2 = start(1L, i2, v[0], actor);

    assertThat(callInTenant(1L, () -> runs.findIdempotent(r1.id(), "k"))).isEmpty();
    assertThat(callInTenant(1L, () -> runs.insertIdempotent(r1.id(), "k", actor, "{\"r\":1}")))
        .isTrue();
    assertThat(callInTenant(1L, () -> runs.insertIdempotent(r1.id(), "k", other, "{\"r\":9}")))
        .isFalse();
    assertThat(callInTenant(1L, () -> runs.insertIdempotent(r2.id(), "k", other, "{\"r\":2}")))
        .isTrue();

    IdempotentRow a = callInTenant(1L, () -> runs.findIdempotent(r1.id(), "k")).orElseThrow();
    IdempotentRow b = callInTenant(1L, () -> runs.findIdempotent(r2.id(), "k")).orElseThrow();
    assertThat(a.actorId()).isEqualTo(actor);
    assertThat(a.responseJson()).isEqualTo("{\"r\": 1}");
    assertThat(b.actorId()).isEqualTo(other);
    assertThat(b.responseJson()).isEqualTo("{\"r\": 2}");
  }

  @Test
  @DisplayName("이벤트는 id 순으로 읽힌다")
  void events_orderedById() {
    long actor = newUser();
    long[] v = newVersion(1L, actor);
    RunRow run = start(1L, newIssue(1L, v[1], actor, 1), v[0], actor);
    callInTenant(
        1L,
        () -> {
          runs.insertEvent(run.id(), "STARTED", "{\"a\":1}", actor, AT);
          runs.insertEvent(run.id(), "MOVED", "{}", null, AT);
          return null;
        });
    assertThat(callInTenant(1L, () -> runs.findEvents(run.id())))
        .extracting(e -> e.type())
        .containsExactly("STARTED", "MOVED");
  }

  @Test
  @DisplayName("다른 테넌트에는 네 표 모두 0 행으로 보이고 앱 런타임 롤로 접속한 것이 맞다")
  void otherTenant_seesNoRows() {
    long actor = newUser();
    long tid2 = ensureFixtureTenant("wf-run-rls");
    long[] v = newVersion(tid2, actor);
    long issue = newIssue(tid2, v[1], actor, 1);
    RunRow run = start(tid2, issue, v[0], actor);
    callInTenant(
        tid2,
        () -> {
          runs.insertNodeRun(run.id(), "n1", 1, "ACTIVE", List.of(1L), List.of(), false, AT);
          runs.insertEvent(run.id(), "STARTED", "{}", actor, AT);
          runs.insertIdempotent(run.id(), "k", actor, "{}");
          return null;
        });

    assertThat(callInTenant(1L, () -> baseDsl.fetchValue("SELECT current_user")))
        .isEqualTo("app_tenant");
    // 자기 테넌트에서는 네 표 모두 보인다(아래 0 이 거짓 통과가 아니다).
    assertThat(
            callInTenant(
                tid2, () -> baseDsl.fetchCount(WORKFLOW_RUN, WORKFLOW_RUN.ID.eq(run.id()))))
        .isEqualTo(1);
    assertThat(callInTenant(tid2, () -> baseDsl.fetchCount(NODE_RUN, NODE_RUN.RUN_ID.eq(run.id()))))
        .isEqualTo(1);
    assertThat(
            callInTenant(
                tid2,
                () ->
                    baseDsl.fetchCount(WORKFLOW_RUN_EVENT, WORKFLOW_RUN_EVENT.RUN_ID.eq(run.id()))))
        .isEqualTo(1);
    assertThat(
            callInTenant(
                tid2,
                () ->
                    baseDsl.fetchCount(
                        WORKFLOW_MOVE_IDEMPOTENCY, WORKFLOW_MOVE_IDEMPOTENCY.RUN_ID.eq(run.id()))))
        .isEqualTo(1);
    assertThat(
            callInTenant(1L, () -> baseDsl.fetchCount(WORKFLOW_RUN, WORKFLOW_RUN.ID.eq(run.id()))))
        .isZero();
    assertThat(callInTenant(1L, () -> baseDsl.fetchCount(NODE_RUN, NODE_RUN.RUN_ID.eq(run.id()))))
        .isZero();
    assertThat(
            callInTenant(
                1L,
                () ->
                    baseDsl.fetchCount(WORKFLOW_RUN_EVENT, WORKFLOW_RUN_EVENT.RUN_ID.eq(run.id()))))
        .isZero();
    assertThat(
            callInTenant(
                1L,
                () ->
                    baseDsl.fetchCount(
                        WORKFLOW_MOVE_IDEMPOTENCY, WORKFLOW_MOVE_IDEMPOTENCY.RUN_ID.eq(run.id()))))
        .isZero();
    assertThat(callInTenant(1L, () -> runs.findRun(run.id()))).isEmpty();
    assertThat(callInTenant(1L, () -> runs.findNodeRuns(run.id()))).isEmpty();
    assertThat(callInTenant(1L, () -> runs.findEvents(run.id()))).isEmpty();
    assertThat(callInTenant(1L, () -> runs.findIdempotent(run.id(), "k"))).isEmpty();
  }
}
