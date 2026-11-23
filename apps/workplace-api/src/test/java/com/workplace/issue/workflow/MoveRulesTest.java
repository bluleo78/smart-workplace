package com.workplace.issue.workflow;

import static com.workplace.issue.workflow.RunModels.DEV1;
import static com.workplace.issue.workflow.RunModels.DEV2;
import static com.workplace.issue.workflow.RunModels.LEAD;
import static com.workplace.issue.workflow.RunModels.OWNER;
import static com.workplace.issue.workflow.RunModels.ids;
import static com.workplace.issue.workflow.RunModels.list;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.issue.workflow.domain.MoveActor;
import com.workplace.issue.workflow.domain.MoveRules;
import com.workplace.issue.workflow.domain.MoveViolation;
import com.workplace.issue.workflow.domain.RunRoleMembers;
import com.workplace.issue.workflow.domain.RunState;
import com.workplace.issue.workflow.domain.WorkflowModel;
import com.workplace.issue.workflow.domain.WorkflowModel.Node;
import com.workplace.issue.workflow.domain.WorkflowModel.Outcome;
import com.workplace.issue.workflow.domain.WorkflowModel.OutputSpec;
import com.workplace.issue.workflow.dto.MoveRequest;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/** 이동 판정(설계 §7 의 4~8)을 DB·Spring 없이 확인한다(WP-1985). 정의는 spec-example.yaml. */
class MoveRulesTest {

  private static final WorkflowModel SPEC = RunModels.spec();
  private static final RunRoleMembers MEMBERS = RunModels.specMembers(SPEC);
  private static final String PR = "https://git.example.com/pr/1";

  /** dev 노드에서 dev1 이 일하는 상태(revision 3). */
  private static RunState devState(WorkflowModel model) {
    return RunModels.state(model, "dev", 3, list(DEV1), ids(DEV1), Map.of(), Map.of());
  }

  /** 상태만 바꾼 사본. */
  private static RunState withStatus(RunState s, String status, String nodeStatus, boolean closed) {
    return new RunState(
        s.model(),
        status,
        s.revision(),
        closed,
        s.currentNode(),
        nodeStatus,
        s.nodeAssignees(),
        s.issueAssignees(),
        s.lastAssigneesByNode(),
        s.context());
  }

  private static MoveRequest req(
      String from, String outcome, Map<String, Object> outputs, List<Long> assignees, String c) {
    return new MoveRequest(from, outcome, outputs, assignees, c, 3, "k1");
  }

  private static Map<String, Object> outputs(Object... kv) {
    Map<String, Object> m = new LinkedHashMap<>();
    for (int i = 0; i < kv.length; i += 2) {
      m.put((String) kv[i], kv[i + 1]);
    }
    return m;
  }

  /** 요청의 fromNode·outcome 으로 노드·결과를 찾아 check 한다(없으면 null 로 넘긴다). */
  private static List<MoveViolation> check(RunState s, MoveRequest r, MoveActor actor) {
    Node from = s.model().nodes().get(r.fromNode());
    Outcome outcome = from == null ? null : from.outcomes().get(r.outcome());
    return MoveRules.check(from, outcome, r, s, actor, MEMBERS);
  }

  private static String firstCode(List<MoveViolation> v) {
    assertThat(v).isNotEmpty();
    return v.get(0).code();
  }

  private static MoveRequest submit(Map<String, Object> outputs) {
    return req("dev", "submitted", outputs, null, null);
  }

  @Test
  @DisplayName("fromNode 가 지금 노드가 아니면 409 STALE, errors 에 currentNode·revision")
  void fromNodeMismatch_stale() {
    List<MoveViolation> v =
        check(devState(SPEC), req("triage", "ready", null, null, null), new MoveActor(DEV1, false));
    assertThat(firstCode(v)).isEqualTo("WORKFLOW_STALE");
    assertThat(v.get(0).status()).isEqualTo(409);
    assertThat(v.get(0).errors())
        .containsEntry("currentNode", "dev")
        .containsEntry("revision", "3");
    assertThat(v).hasSize(1);
  }

  @Test
  @DisplayName("expectedRevision 이 다르면 409 STALE")
  void revisionMismatch_stale() {
    MoveRequest r = new MoveRequest("dev", "submitted", outputs("prUrl", PR), null, null, 2, "k");
    List<MoveViolation> v = check(devState(SPEC), r, new MoveActor(DEV1, false));
    assertThat(firstCode(v)).isEqualTo("WORKFLOW_STALE");
    assertThat(v.get(0).errors())
        .containsEntry("currentNode", "dev")
        .containsEntry("revision", "3");
    MoveRequest missing =
        new MoveRequest("dev", "submitted", outputs("prUrl", PR), null, null, null, "k");
    assertThat(firstCode(check(devState(SPEC), missing, new MoveActor(DEV1, false))))
        .isEqualTo("WORKFLOW_STALE");
  }

  @Test
  @DisplayName("담당도 관리자도 아니면 403 NOT_ASSIGNEE")
  void notAssignee_forbidden() {
    List<MoveViolation> v =
        check(devState(SPEC), submit(outputs("prUrl", PR)), new MoveActor(DEV2, false));
    assertThat(firstCode(v)).isEqualTo("WORKFLOW_NOT_ASSIGNEE");
    assertThat(v.get(0).status()).isEqualTo(403);
  }

  @Test
  @DisplayName("이슈 담당에서 빠진 노드 담당은 담당으로 보지 않는다")
  void removedFromIssue_notAssignee() {
    RunState s = RunModels.state(SPEC, "dev", 3, list(DEV1), ids(), Map.of(), Map.of());
    assertThat(firstCode(check(s, submit(outputs("prUrl", PR)), new MoveActor(DEV1, false))))
        .isEqualTo("WORKFLOW_NOT_ASSIGNEE");
  }

  @Test
  @DisplayName("담당이 아닌 관리자는 통과하고 override 로 기록된다")
  void projectManager_allowedAsOverride() {
    RunState s = devState(SPEC);
    MoveActor manager = new MoveActor(OWNER, true);
    assertThat(check(s, submit(outputs("prUrl", PR)), manager)).isEmpty();
    assertThat(manager.isOverride(s)).isTrue();
  }

  @Test
  @DisplayName("담당이면서 관리자면 override 가 아니다")
  void assigneeWhoIsManager_notOverride() {
    RunState s = devState(SPEC);
    MoveActor actor = new MoveActor(DEV1, true);
    assertThat(check(s, submit(outputs("prUrl", PR)), actor)).isEmpty();
    assertThat(actor.isOverride(s)).isFalse();
  }

  @Test
  @DisplayName("노드에 없는 결과는 422 UNKNOWN_OUTCOME")
  void unknownOutcome() {
    List<MoveViolation> v =
        check(devState(SPEC), req("dev", "nope", null, null, null), new MoveActor(DEV1, false));
    assertThat(firstCode(v)).isEqualTo("WORKFLOW_UNKNOWN_OUTCOME");
    assertThat(v.get(0).status()).isEqualTo(422);
    assertThat(v).hasSize(1);
  }

  @Test
  @DisplayName("SUSPENDED 실행이나 BLOCKED·FAILED 노드는 409 NODE_SUSPENDED")
  void suspendedNode_rejected() {
    MoveActor actor = new MoveActor(DEV1, false);
    MoveRequest r = submit(outputs("prUrl", PR));
    RunState base = devState(SPEC);
    assertThat(firstCode(check(withStatus(base, "SUSPENDED", "ACTIVE", false), r, actor)))
        .isEqualTo("WORKFLOW_NODE_SUSPENDED");
    assertThat(firstCode(check(withStatus(base, "RUNNING", "BLOCKED", false), r, actor)))
        .isEqualTo("WORKFLOW_NODE_SUSPENDED");
    assertThat(firstCode(check(withStatus(base, "RUNNING", "FAILED", false), r, actor)))
        .isEqualTo("WORKFLOW_NODE_SUSPENDED");
  }

  @Test
  @DisplayName("WAITING(사람 노드)에서도 이동할 수 있다")
  void waitingNode_canMove() {
    RunState s =
        withStatus(
            RunModels.state(SPEC, "plan_ok", 3, list(OWNER), ids(OWNER), Map.of(), Map.of()),
            "WAITING",
            "ACTIVE",
            false);
    MoveRequest r = req("plan_ok", "approve", null, list(DEV2), null);
    assertThat(check(s, r, new MoveActor(OWNER, false))).isEmpty();
    assertThat(MoveRules.plan(r, s, MEMBERS).resolution().assignees()).containsExactly(DEV2);
  }

  @Test
  @DisplayName("끝난 실행이나 닫힌 이슈는 409 NOT_ACTIVE")
  void endedRun_notActive() {
    MoveActor actor = new MoveActor(DEV1, false);
    MoveRequest r = submit(outputs("prUrl", PR));
    RunState base = devState(SPEC);
    assertThat(firstCode(check(withStatus(base, "COMPLETED", "COMPLETED", false), r, actor)))
        .isEqualTo("WORKFLOW_NOT_ACTIVE");
    assertThat(firstCode(check(withStatus(base, "CANCELED", "CANCELED", false), r, actor)))
        .isEqualTo("WORKFLOW_NOT_ACTIVE");
    assertThat(firstCode(check(withStatus(base, "RUNNING", "ACTIVE", true), r, actor)))
        .isEqualTo("WORKFLOW_NOT_ACTIVE");
  }

  @Test
  @DisplayName("required 출력이 없으면 OUTPUT_MISSING, errors.keys 에 키 이름")
  void requiredOutputMissing() {
    MoveActor actor = new MoveActor(DEV1, false);
    List<MoveViolation> v = check(devState(SPEC), submit(null), actor);
    assertThat(firstCode(v)).isEqualTo("WORKFLOW_OUTPUT_MISSING");
    assertThat(v.get(0).errors()).containsEntry("keys", "prUrl");
    assertThat(firstCode(check(devState(SPEC), submit(outputs("prUrl", "  ")), actor)))
        .isEqualTo("WORKFLOW_OUTPUT_MISSING");
  }

  @Test
  @DisplayName("url 출력은 host 있는 http(s) 만")
  void urlOutputInvalid() {
    MoveActor actor = new MoveActor(DEV1, false);
    for (String bad : List.of("abc", "javascript:x", "https://", "ftp://x.com/a")) {
      List<MoveViolation> v = check(devState(SPEC), submit(outputs("prUrl", bad)), actor);
      assertThat(firstCode(v)).as(bad).isEqualTo("WORKFLOW_OUTPUT_INVALID");
      assertThat(v.get(0).errors()).containsEntry("keys", "prUrl");
    }
    assertThat(check(devState(SPEC), submit(outputs("prUrl", "HTTP://x.com")), actor)).isEmpty();
  }

  @Test
  @DisplayName("선언하지 않은 출력 키는 OUTPUT_INVALID")
  void undeclaredOutput_invalid() {
    List<MoveViolation> v =
        check(
            devState(SPEC), submit(outputs("prUrl", PR, "extra", "x")), new MoveActor(DEV1, false));
    assertThat(firstCode(v)).isEqualTo("WORKFLOW_OUTPUT_INVALID");
    assertThat(v.get(0).errors()).containsEntry("keys", "extra");
  }

  @Test
  @DisplayName("number 출력은 유한한 수만 — NaN·무한·글은 거절")
  void numberOutput_rejectsNaNAndString() {
    Map<String, OutputSpec> specs = new LinkedHashMap<>();
    specs.put("prUrl", new OutputSpec("url", true));
    specs.put("score", new OutputSpec("number", false));
    specs.put("ok", new OutputSpec("boolean", false));
    WorkflowModel model = RunModels.withOutputs(SPEC, "dev", specs);
    MoveActor actor = new MoveActor(DEV1, false);
    for (Object bad : List.of(Double.NaN, Double.POSITIVE_INFINITY, "1", true)) {
      assertThat(
              firstCode(check(devState(model), submit(outputs("prUrl", PR, "score", bad)), actor)))
          .as(String.valueOf(bad))
          .isEqualTo("WORKFLOW_OUTPUT_INVALID");
    }
    assertThat(firstCode(check(devState(model), submit(outputs("prUrl", PR, "ok", "true")), actor)))
        .isEqualTo("WORKFLOW_OUTPUT_INVALID");
    assertThat(
            check(devState(model), submit(outputs("prUrl", PR, "score", 1.5, "ok", false)), actor))
        .isEmpty();
    assertThat(check(devState(model), submit(outputs("prUrl", PR, "score", 7L)), actor)).isEmpty();
  }

  @Test
  @DisplayName("출력 JSON 이 64 KiB 를 넘거나 NUL·짝 없는 서로게이트가 있으면 OUTPUT_INVALID")
  void outputs_over64KiB_orNul_invalid() {
    Map<String, OutputSpec> specs = new LinkedHashMap<>();
    specs.put("prUrl", new OutputSpec("url", true));
    specs.put("note", new OutputSpec("string", false));
    WorkflowModel model = RunModels.withOutputs(SPEC, "dev", specs);
    MoveActor actor = new MoveActor(DEV1, false);
    String big = "a".repeat(70_000);
    assertThat(firstCode(check(devState(model), submit(outputs("prUrl", PR, "note", big)), actor)))
        .isEqualTo("WORKFLOW_OUTPUT_INVALID");
    assertThat(
            firstCode(
                check(devState(model), submit(outputs("prUrl", PR, "note", "a\u0000b")), actor)))
        .isEqualTo("WORKFLOW_OUTPUT_INVALID");
    assertThat(
            firstCode(
                check(devState(model), submit(outputs("prUrl", PR, "note", "a\uD800b")), actor)))
        .isEqualTo("WORKFLOW_OUTPUT_INVALID");
    assertThat(check(devState(model), submit(outputs("prUrl", PR, "note", "한글 메모")), actor))
        .isEmpty();
  }

  @Test
  @DisplayName("질문 결과(목적 노드의 returnTo 가 지금 노드)는 required 를 묻지 않지만 보낸 값의 형식은 본다")
  void askOutcome_skipsRequiredOutputs() {
    MoveActor actor = new MoveActor(DEV1, false);
    assertThat(check(devState(SPEC), req("dev", "ask", null, null, "어디에 두나요?"), actor)).isEmpty();
    List<MoveViolation> v =
        check(devState(SPEC), req("dev", "ask", outputs("prUrl", "abc"), null, "질문"), actor);
    assertThat(firstCode(v)).isEqualTo("WORKFLOW_OUTPUT_INVALID");
  }

  @Test
  @DisplayName("requireComment 결과에 의견이 없거나 공백이면 COMMENT_REQUIRED")
  void requireComment_missing() {
    MoveActor actor = new MoveActor(DEV1, false);
    assertThat(firstCode(check(devState(SPEC), req("dev", "ask", null, null, null), actor)))
        .isEqualTo("WORKFLOW_COMMENT_REQUIRED");
    assertThat(firstCode(check(devState(SPEC), req("dev", "ask", null, null, "  "), actor)))
        .isEqualTo("WORKFLOW_COMMENT_REQUIRED");
    // 댓글 API 의 @VisibleText 와 같은 기준 — 제로폭 문자만 있으면 의견이 없는 것이다
    assertThat(firstCode(check(devState(SPEC), req("dev", "ask", null, null, "\u200B"), actor)))
        .isEqualTo("WORKFLOW_COMMENT_REQUIRED");
  }

  @Test
  @DisplayName("단계 8 의 위반은 모두 모으고 결과·출력·의견·담당 순서로 둔다")
  void stageEightViolations_allCollectedInOrder() {
    // ask 로 질문하며 형식이 틀린 prUrl 을 보내고 의견도 없다 → INVALID, COMMENT_REQUIRED
    List<MoveViolation> v =
        check(
            devState(SPEC),
            req("dev", "ask", outputs("prUrl", "abc"), null, null),
            new MoveActor(DEV1, false));
    assertThat(v)
        .extracting(MoveViolation::code)
        .containsExactly("WORKFLOW_OUTPUT_INVALID", "WORKFLOW_COMMENT_REQUIRED");
  }

  /** 낡은 revision(2) 으로 보낸 정상 제출. */
  private static MoveRequest staleSubmit() {
    return new MoveRequest("dev", "submitted", outputs("prUrl", PR), null, null, 2, "k");
  }

  @Test
  @DisplayName("겹친 위반은 §7 순서의 앞 단계 하나만 — 끝난 실행 + 낡은 revision → NOT_ACTIVE")
  void order_endedAndStale_notActive() {
    RunState s = withStatus(devState(SPEC), "COMPLETED", "COMPLETED", false);
    List<MoveViolation> v = check(s, staleSubmit(), new MoveActor(DEV1, false));
    assertThat(v).hasSize(1);
    assertThat(v.get(0).code()).isEqualTo("WORKFLOW_NOT_ACTIVE");
  }

  @Test
  @DisplayName("겹친 위반 — 낡은 revision + SUSPENDED → STALE")
  void order_staleAndSuspended_stale() {
    RunState s = withStatus(devState(SPEC), "SUSPENDED", "ACTIVE", false);
    List<MoveViolation> v = check(s, staleSubmit(), new MoveActor(DEV1, false));
    assertThat(v).hasSize(1);
    assertThat(v.get(0).code()).isEqualTo("WORKFLOW_STALE");
  }

  @Test
  @DisplayName("겹친 위반 — SUSPENDED + 담당 아님 → 409 NODE_SUSPENDED(403 아님)")
  void order_suspendedAndNotAssignee_suspended() {
    RunState s = withStatus(devState(SPEC), "SUSPENDED", "ACTIVE", false);
    List<MoveViolation> v = check(s, submit(outputs("prUrl", PR)), new MoveActor(DEV2, false));
    assertThat(v).hasSize(1);
    assertThat(v.get(0).code()).isEqualTo("WORKFLOW_NODE_SUSPENDED");
  }

  @Test
  @DisplayName("겹친 위반 — 담당 아님 + 없는 결과 → NOT_ASSIGNEE")
  void order_notAssigneeAndUnknownOutcome_forbidden() {
    List<MoveViolation> v =
        check(devState(SPEC), req("dev", "nope", null, null, null), new MoveActor(DEV2, false));
    assertThat(v).hasSize(1);
    assertThat(v.get(0).code()).isEqualTo("WORKFLOW_NOT_ASSIGNEE");
  }

  @Test
  @DisplayName("단계 8 은 모두 모은다 — 출력 빠짐·선언 밖 키·의견 없음·담당 필요 순서")
  void order_stageEight_missingInvalidCommentAssignee() {
    WorkflowModel base =
        RunModels.model(
            List.of(RunModels.role("developer", "dev1@example.com", "dev2@example.com")),
            List.of(),
            RunModels.start("start"),
            RunModels.task("work", "developer", new Outcome("go", "next", "developer", true)),
            RunModels.task("next", "developer", RunModels.out("done", "end", null)),
            RunModels.end("end"));
    WorkflowModel model =
        RunModels.withOutputs(base, "work", Map.of("prUrl", new OutputSpec("url", true)));
    RunState s = RunModels.state(model, "work", 0, list(DEV1), ids(DEV1), Map.of(), Map.of());
    MoveRequest r = new MoveRequest("work", "go", outputs("extra", "x"), null, null, 0, "k");
    Node from = model.nodes().get("work");
    List<MoveViolation> v =
        MoveRules.check(
            from,
            from.outcomes().get("go"),
            r,
            s,
            new MoveActor(DEV1, false),
            RunModels.specMembers(model));
    assertThat(v)
        .extracting(MoveViolation::code)
        .containsExactly(
            "WORKFLOW_OUTPUT_MISSING",
            "WORKFLOW_OUTPUT_INVALID",
            "WORKFLOW_COMMENT_REQUIRED",
            "WORKFLOW_ASSIGNEE_REQUIRED");
  }

  @Test
  @DisplayName("역할 구성원이 여럿이면 assigneeIds 필수 — errors 에 role·candidates")
  void roleWithManyMembers_requiresAssignees() {
    RunState s = RunModels.state(SPEC, "triage", 3, list(LEAD), ids(LEAD), Map.of(), Map.of());
    List<MoveViolation> v =
        check(s, req("triage", "ready", null, null, null), new MoveActor(LEAD, false));
    assertThat(firstCode(v)).isEqualTo("WORKFLOW_ASSIGNEE_REQUIRED");
    assertThat(v.get(0).status()).isEqualTo(422);
    assertThat(v.get(0).errors())
        .containsEntry("role", "developer")
        .containsEntry("candidates", "dev1@example.com,dev2@example.com");
  }

  @Test
  @DisplayName("역할 밖 사람을 assigneeIds 로 보내면 ASSIGNEE_NOT_IN_ROLE")
  void assigneeNotInRole() {
    RunState s = RunModels.state(SPEC, "triage", 3, list(LEAD), ids(LEAD), Map.of(), Map.of());
    List<MoveViolation> v =
        check(s, req("triage", "ready", null, list(LEAD), null), new MoveActor(LEAD, false));
    assertThat(firstCode(v)).isEqualTo("WORKFLOW_ASSIGNEE_NOT_IN_ROLE");
    assertThat(v.get(0).errors()).containsEntry("role", "developer");
  }

  @Test
  @DisplayName("바로 뒤 decision 은 이번 이동이 낸 출력으로 판정한다")
  void decisionAfterMove_readsThisMovesOutputs() {
    WorkflowModel base =
        RunModels.model(
            List.of(RunModels.role("developer", "dev1@example.com")),
            List.of(),
            RunModels.start("start"),
            RunModels.task("work", "developer", RunModels.out("go", "d", null)),
            RunModels.decision("d", "b", RunModels.byContext("work.score", 1L, "a")),
            RunModels.task("a", "developer", RunModels.out("done", "end", null)),
            RunModels.task("b", "developer", RunModels.out("done", "end", null)),
            RunModels.end("end"));
    WorkflowModel model =
        RunModels.withOutputs(base, "work", Map.of("score", new OutputSpec("number", false)));
    RunRoleMembers members = RunModels.specMembers(model);
    Map<String, Object> previous = Map.of("work", Map.of("score", 2L));
    RunState s = RunModels.state(model, "work", 0, list(DEV1), ids(DEV1), Map.of(), previous);

    MoveRequest withScore = new MoveRequest("work", "go", outputs("score", 1L), null, null, 0, "k");
    assertThat(MoveRules.plan(withScore, s, members).route().stopNode()).isEqualTo("a");
    MoveRequest without = new MoveRequest("work", "go", null, null, null, 0, "k");
    assertThat(MoveRules.plan(without, s, members).route().stopNode()).isEqualTo("b");
    assertThat(s.context()).isEqualTo(previous);
    // 저장도 같은 덮은 context 를 쓰도록 계획에 담긴다
    assertThat(MoveRules.plan(withScore, s, members).context())
        .isEqualTo(Map.of("work", Map.of("score", 1L)));
    assertThat(MoveRules.plan(without, s, members).context()).isEqualTo(previous);
  }

  @Test
  @DisplayName("keep 은 목적 노드의 가장 최근 담당을 쓴다 — 답하면 질문한 개발자 한 명에게")
  void assignToKeep_usesPreviousAssigneeOfTargetNode() {
    Map<String, List<Long>> last = new HashMap<>();
    last.put("dev", list(DEV2));
    RunState s =
        withStatus(
            RunModels.state(SPEC, "dev_ask", 3, list(OWNER), ids(OWNER, DEV2), last, Map.of()),
            "WAITING",
            "ACTIVE",
            false);
    MoveRequest r = req("dev_ask", "answered", null, null, "여기에 두세요");
    assertThat(check(s, r, new MoveActor(OWNER, false))).isEmpty();
    assertThat(MoveRules.plan(r, s, MEMBERS).resolution().assignees()).containsExactly(DEV2);
  }
}
