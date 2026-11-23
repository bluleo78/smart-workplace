package com.workplace.issue.workflow;

import static com.workplace.issue.workflow.RunModels.byRole;
import static com.workplace.issue.workflow.RunModels.decision;
import static com.workplace.issue.workflow.RunModels.end;
import static com.workplace.issue.workflow.RunModels.ids;
import static com.workplace.issue.workflow.RunModels.list;
import static com.workplace.issue.workflow.RunModels.out;
import static com.workplace.issue.workflow.RunModels.role;
import static com.workplace.issue.workflow.RunModels.start;
import static com.workplace.issue.workflow.RunModels.task;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.issue.workflow.domain.ActiveMember;
import com.workplace.issue.workflow.domain.AssigneeResolution;
import com.workplace.issue.workflow.domain.AssigneeResolution.Options;
import com.workplace.issue.workflow.domain.AssigneeResolution.Resolution;
import com.workplace.issue.workflow.domain.MoveActor;
import com.workplace.issue.workflow.domain.MoveRules;
import com.workplace.issue.workflow.domain.RunRoleMembers;
import com.workplace.issue.workflow.domain.RunState;
import com.workplace.issue.workflow.domain.WorkflowModel;
import com.workplace.issue.workflow.domain.WorkflowModel.Node;
import com.workplace.issue.workflow.domain.WorkflowRouting;
import com.workplace.issue.workflow.domain.WorkflowRouting.Route;
import com.workplace.issue.workflow.domain.WorkflowRouting.StartMatch;
import com.workplace.issue.workflow.dto.MoveRequest;
import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/** 담당 정하기(설계 §6·§7 표·§11 options)를 표의 줄마다 확인한다(WP-1985). DB·Spring 없음. */
class AssigneeResolutionTest {

  private static final long A = 11L;
  private static final long B = 12L;
  private static final long C = 13L;

  /** a·b·c 가 모두 지금 활성인 표. */
  private static RunRoleMembers members(WorkflowModel model) {
    return RunRoleMembers.of(
        model,
        List.of(new ActiveMember(A, "a"), new ActiveMember(B, "b"), new ActiveMember(C, "c")));
  }

  /**
   * from(x 역할)에서 나가는 결과들: direct(→ t, x), viaD(→ d → t, x), keep(→ t, keep), omit(→ t), toEnd(→
   * end), dKeep(→ d, keep). t·d 의 역할은 y.
   */
  private static WorkflowModel model(List<String> x, List<String> y) {
    return RunModels.model(
        List.of(role("x", x.toArray(String[]::new)), role("y", y.toArray(String[]::new))),
        List.of(byRole("x", "from")),
        start("start"),
        task(
            "from",
            "x",
            out("direct", "t", "x"),
            out("viaD", "d", "x"),
            out("keep", "t", "keep"),
            out("omit", "t", null),
            out("toEnd", "end", null),
            out("dKeep", "d", "keep"),
            out("dOmit", "d", null)),
        decision("d", "t"),
        task("t", "y", out("done", "end", null)),
        end("end"));
  }

  private static RunState state(
      WorkflowModel model,
      List<Long> nodeAssignees,
      Set<Long> issue,
      Map<String, List<Long>> last) {
    return RunModels.state(model, "from", 0, nodeAssignees, issue, last, Map.of());
  }

  private static Resolution move(
      WorkflowModel model, RunState s, String outcome, List<Long> requested) {
    MoveRequest r = new MoveRequest("from", outcome, null, requested, null, 0, "k");
    return MoveRules.plan(r, s, members(model)).resolution();
  }

  private static Resolution move(WorkflowModel model, String outcome, List<Long> requested) {
    return move(model, state(model, list(A), ids(A), Map.of()), outcome, requested);
  }

  private static Resolution startWith(WorkflowModel model, Collection<Long> issueAssignees) {
    RunRoleMembers m = members(model);
    StartMatch match = WorkflowRouting.start(model, issueAssignees, m).orElseThrow();
    Route route = WorkflowRouting.route(model, match.to(), match.matched(), Map.of(), m);
    return AssigneeResolution.forStart(model, match, route, issueAssignees, m);
  }

  @Test
  @DisplayName("역할 X 로 바로 task — X ∩ Y 한 명이면 그 사람, 비면 남은 구성원 없음")
  void role_direct_intersectsTargetRole() {
    WorkflowModel overlap = model(List.of("a", "b"), List.of("b", "c"));
    Resolution r = move(overlap, "direct", null);
    assertThat(r.violation()).isNull();
    assertThat(r.assignees()).containsExactly(B);

    WorkflowModel disjoint = model(List.of("a"), List.of("c"));
    Resolution none = move(disjoint, "direct", null);
    assertThat(none.violation().code()).isEqualTo("WORKFLOW_ASSIGNEE_REQUIRED");
    assertThat(none.violation().errors())
        .containsEntry("role", "y")
        .containsEntry("candidates", "");

    WorkflowModel both = model(List.of("b", "c"), List.of("b", "c"));
    assertThat(move(both, "direct", null).violation().errors()).containsEntry("candidates", "b,c");
    assertThat(move(both, "direct", list(C)).assignees()).containsExactly(C);
  }

  @Test
  @DisplayName("역할 X 로 decision 을 지나면 X ∩ Y 가 빌 때 Y 로 물러선다")
  void role_throughDecision_fallsBackToTargetRole() {
    WorkflowModel disjoint = model(List.of("a"), List.of("c"));
    Resolution r = move(disjoint, "viaD", null);
    assertThat(r.violation()).isNull();
    assertThat(r.assignees()).containsExactly(C);
  }

  @Test
  @DisplayName("keep 인데 목적 노드의 앞 담당이 없으면 Y 가 한 명이어도 assigneeIds 필수")
  void keep_noPrevious_requiresExplicitEvenIfSingle() {
    WorkflowModel model = model(List.of("a"), List.of("c"));
    Resolution r = move(model, "keep", null);
    assertThat(r.violation().code()).isEqualTo("WORKFLOW_ASSIGNEE_REQUIRED");
    assertThat(r.violation().errors()).containsEntry("role", "y").containsEntry("candidates", "c");
    assertThat(move(model, "keep", list(C)).assignees()).containsExactly(C);
    assertThat(move(model, "keep", list(A)).violation().code())
        .isEqualTo("WORKFLOW_ASSIGNEE_NOT_IN_ROLE");
  }

  @Test
  @DisplayName("생략은 현재 노드 담당 중 지금도 이슈 담당인 사람만 기준으로 삼는다")
  void omitted_filtersRemovedIssueAssignee() {
    WorkflowModel model = model(List.of("b", "c"), List.of("b", "c"));
    RunState s = state(model, list(B, C), ids(C), Map.of());
    Resolution r = move(model, s, "omit", null);
    assertThat(r.violation()).isNull();
    assertThat(r.assignees()).containsExactly(C);
  }

  @Test
  @DisplayName("생략인데 현재 담당이 Y 밖이면 Y 안에서 고른 사람을 받는다")
  void omitted_outsideRole_acceptsExplicit() {
    WorkflowModel model = model(List.of("a"), List.of("c"));
    assertThat(move(model, "omit", null).violation().code())
        .isEqualTo("WORKFLOW_ASSIGNEE_REQUIRED");
    assertThat(move(model, "omit", list(C)).assignees()).containsExactly(C);
    assertThat(move(model, "omit", list(A)).violation().code())
        .isEqualTo("WORKFLOW_ASSIGNEE_NOT_IN_ROLE");
  }

  @Test
  @DisplayName("기준이 정해지면 다른 assigneeIds 는 NOT_IN_ROLE")
  void resolvedBasis_rejectsDifferentExplicit() {
    WorkflowModel model = model(List.of("a"), List.of("b", "c"));
    RunState s = state(model, list(A), ids(A), Map.of("t", list(B)));
    assertThat(move(model, s, "keep", null).assignees()).containsExactly(B);
    assertThat(move(model, s, "keep", list(B)).assignees()).containsExactly(B);
    Resolution other = move(model, s, "keep", list(C));
    assertThat(other.violation().code()).isEqualTo("WORKFLOW_ASSIGNEE_NOT_IN_ROLE");
    assertThat(other.violation().errors())
        .containsEntry("role", "y")
        .containsEntry("candidates", "b");
    // 일부만 보내도 거절 — candidates 는 기준 담당, 문장은 다시 보낼 방법
    Resolution partial = move(model, s, "keep", list(B, C));
    assertThat(partial.violation().code()).isEqualTo("WORKFLOW_ASSIGNEE_NOT_IN_ROLE");
    assertThat(partial.violation().errors()).containsEntry("candidates", "b");
    assertThat(partial.violation().message()).contains("기준 담당이 그대로 이어집니다");
  }

  @Test
  @DisplayName("keep 이 decision 을 지나면 최종 노드의 앞 담당, 없으면 고르라 한다")
  void keep_throughDecision_usesFinalNodePrevious() {
    WorkflowModel model = model(List.of("a"), List.of("b", "c"));
    RunState prev = state(model, list(A), ids(A), Map.of("t", list(C)));
    assertThat(move(model, prev, "dKeep", null).assignees()).containsExactly(C);
    assertThat(move(model, "dKeep", null).violation().code())
        .isEqualTo("WORKFLOW_ASSIGNEE_REQUIRED");
  }

  @Test
  @DisplayName("생략이 decision 을 지나면 현재 담당 ∩ 이슈 담당 ∩ 최종 노드 역할")
  void omitted_throughDecision_usesCurrentAssignees() {
    WorkflowModel model = model(List.of("b", "c"), List.of("b", "c"));
    RunState s = state(model, list(B, C), ids(B), Map.of());
    assertThat(move(model, s, "dOmit", null).assignees()).containsExactly(B);
  }

  /**
   * from(x) 에서 go(assignTo x 또는 keep·생략)로 d 를 지나는 정의 — d 는 assigneeRole {@code endRole} 이면 end, 아니면
   * t(y). x=[a,b], y=[b], o=[c].
   */
  private static WorkflowModel steerable(String endRole, String assignTo) {
    return RunModels.model(
        List.of(role("x", "a", "b"), role("y", "b"), role("o", "c")),
        List.of(byRole("x", "from")),
        start("start"),
        task("from", "x", out("go", "d", assignTo)),
        decision("d", "t", byRole(endRole, "end")),
        task("t", "y", out("done", "end", null)),
        end("end"));
  }

  private static MoveRules.MovePlan planGo(WorkflowModel model, List<Long> requested) {
    MoveRequest r = new MoveRequest("from", "go", null, requested, null, 0, "k");
    return MoveRules.plan(r, state(model, list(A), ids(A), Map.of()), members(model));
  }

  @Test
  @DisplayName("assignTo 역할 밖 id 로 decision 을 end 로 몰 수 없다 — 라우팅은 역할 구성원 기준, 담당은 NOT_IN_ROLE")
  void roleOutsideIds_cannotSteerDecisionToEnd() {
    // c 는 o 역할이라 기준으로 쓰이면 end 로 간다. x 밖이라 기준에서 빠지고 t 로 가서 거절된다.
    MoveRules.MovePlan steered = planGo(steerable("o", "x"), list(C));
    assertThat(steered.route().stopNode()).isEqualTo("t");
    assertThat(steered.resolution().violation().code()).isEqualTo("WORKFLOW_ASSIGNEE_NOT_IN_ROLE");

    // 역할 구성원 기준으로도 end 에 닿으면 담당 검증이 없던 자리 — 역할 밖 id 는 X 기준으로 거절한다.
    MoveRules.MovePlan toEnd = planGo(steerable("x", "x"), list(C));
    assertThat(toEnd.route().stopNode()).isEqualTo("end");
    assertThat(toEnd.resolution().violation().code()).isEqualTo("WORKFLOW_ASSIGNEE_NOT_IN_ROLE");
    assertThat(toEnd.resolution().violation().errors())
        .containsEntry("role", "x")
        .containsEntry("candidates", "a,b");

    // 역할 안 id 는 지금처럼 기준이 되고 end 면 담당 없음.
    MoveRules.MovePlan inRole = planGo(steerable("x", "x"), list(A));
    assertThat(inRole.route().stopNode()).isEqualTo("end");
    assertThat(inRole.resolution().violation()).isNull();
  }

  @Test
  @DisplayName("keep·생략의 assigneeIds 는 decision 기준이 아니다 — 현재 노드 담당으로 판정한다")
  void keepOrOmitted_idsDoNotSteerDecision() {
    for (String assignTo : new String[] {"keep", null}) {
      // c(o 역할)를 보내도 기준은 현재 담당 a 라 t 로 가고, t 의 고르기에서 거절된다.
      MoveRules.MovePlan plan = planGo(steerable("o", assignTo), list(C));
      assertThat(plan.route().stopNode()).isEqualTo("t");
      assertThat(plan.resolution().violation().code()).isEqualTo("WORKFLOW_ASSIGNEE_NOT_IN_ROLE");
    }
  }

  @Test
  @DisplayName("decision 을 지나 X ∩ Y 가 비면 Y 에서 고른 id 는 지금처럼 받는다")
  void throughDecision_fallbackPickStillAccepted() {
    WorkflowModel disjoint = model(List.of("a"), List.of("b", "c"));
    Resolution r = move(disjoint, "viaD", list(B));
    assertThat(r.violation()).isNull();
    assertThat(r.assignees()).containsExactly(B);
  }

  /** from(y) --go(assignTo y)--> d1 … d21 → t(y), start(assigneeRole y) → d1. 연쇄 한도를 넘는다. */
  private static WorkflowModel overLimit() {
    List<Node> nodes = new ArrayList<>();
    nodes.add(start("start"));
    nodes.add(task("from", "y", out("go", "d1", "y")));
    for (int i = 1; i <= 21; i++) {
      nodes.add(decision("d" + i, i == 21 ? "t" : "d" + (i + 1)));
    }
    nodes.add(task("t", "y", out("done", "end", null)));
    nodes.add(end("end"));
    return RunModels.model(
        List.of(role("y", "b", "c")), List.of(byRole("y", "d1")), nodes.toArray(Node[]::new));
  }

  @Test
  @DisplayName("연쇄 한도를 넘으면 check·forMove·forStart 모두 담당 위반을 내지 않는다")
  void limitExceeded_noAssigneeViolation() {
    WorkflowModel model = overLimit();
    RunRoleMembers m = members(model);
    RunState s = state(model, list(B), ids(B), Map.of());
    MoveRequest r = new MoveRequest("from", "go", null, null, null, 0, "k");
    Node from = model.nodes().get("from");
    assertThat(MoveRules.check(from, from.outcomes().get("go"), r, s, new MoveActor(B, false), m))
        .isEmpty();
    MoveRules.MovePlan plan = MoveRules.plan(r, s, m);
    assertThat(plan.route().limitExceeded()).isTrue();
    assertThat(plan.resolution().violation()).isNull();
    assertThat(plan.resolution().assignees()).isEmpty();

    Resolution start = startWith(model, ids(B));
    assertThat(start.violation()).isNull();
    assertThat(start.assignees()).isEmpty();
  }

  @Test
  @DisplayName("연쇄 한도를 넘어도 assignTo 역할 밖 id 는 NOT_IN_ROLE, 역할 안 id 는 위반 없음(담당은 정하지 않음)")
  void limitExceeded_assignToOutsideRole_rejected() {
    WorkflowModel model = overLimit();
    RunState s = state(model, list(B), ids(B), Map.of());

    // a 는 y(b·c) 밖 — 담당을 정하지 않는 자리여도 역할 밖 사람을 보내면 거절한다.
    MoveRequest outside = new MoveRequest("from", "go", null, list(A), null, 0, "k");
    MoveRules.MovePlan rejected = MoveRules.plan(outside, s, members(model));
    assertThat(rejected.route().limitExceeded()).isTrue();
    assertThat(rejected.resolution().violation().code()).isEqualTo("WORKFLOW_ASSIGNEE_NOT_IN_ROLE");

    // c 는 y 안 — 위반이 없고 담당은 비어 있다.
    MoveRequest inside = new MoveRequest("from", "go", null, list(C), null, 0, "k");
    MoveRules.MovePlan accepted = MoveRules.plan(inside, s, members(model));
    assertThat(accepted.route().limitExceeded()).isTrue();
    assertThat(accepted.resolution().violation()).isNull();
    assertThat(accepted.resolution().assignees()).isEmpty();
  }

  @Test
  @DisplayName("시작이 decision 을 지나도 같은 순서 — 매치 ∩ Y, 이슈 담당 ∩ Y, Y 의 유일한 구성원")
  void start_throughDecision() {
    WorkflowModel model =
        RunModels.model(
            List.of(role("x", "a"), role("y", "c")),
            List.of(byRole("x", "d")),
            start("start"),
            decision("d", "t"),
            task("t", "y", out("done", "end", null)),
            end("end"));
    Resolution r = startWith(model, ids(A));
    assertThat(r.violation()).isNull();
    assertThat(r.assignees()).containsExactly(C);
  }

  @Test
  @DisplayName("시작 목적이 end 면 담당 없음")
  void start_toEnd_noAssignees() {
    WorkflowModel model =
        RunModels.model(
            List.of(role("x", "a")), List.of(byRole("x", "end")), start("start"), end("end"));
    Resolution r = startWith(model, ids(A));
    assertThat(r.violation()).isNull();
    assertThat(r.assignees()).isEmpty();
  }

  @Test
  @DisplayName("최종이 end 면 담당 없음 — assigneeIds 는 보지 않는다")
  void end_noAssignees() {
    WorkflowModel model = model(List.of("a"), List.of("c"));
    Resolution r = move(model, "toEnd", list(999L));
    assertThat(r.violation()).isNull();
    assertThat(r.assignees()).isEmpty();
  }

  @Test
  @DisplayName("시작: 매치된 사람이 Y 밖이면 이슈 담당 ∩ Y, 그것도 없으면 Y 의 유일한 구성원")
  void start_matchOutsideRole_usesIssueAssigneeThenSoleMember() {
    WorkflowModel many = startModel(List.of("a"), List.of("b", "c"));
    Resolution fromIssue = startWith(many, ids(A, C));
    assertThat(fromIssue.violation()).isNull();
    assertThat(fromIssue.assignees()).containsExactly(C);

    WorkflowModel sole = startModel(List.of("a"), List.of("c"));
    Resolution soleMember = startWith(sole, ids(A));
    assertThat(soleMember.violation()).isNull();
    assertThat(soleMember.assignees()).containsExactly(C);

    WorkflowModel inRole = startModel(List.of("a", "b"), List.of("b", "c"));
    assertThat(startWith(inRole, ids(B, C)).assignees()).containsExactly(B);
  }

  @Test
  @DisplayName("시작: Y 밖 매치에 Y 가 여럿이면 ASSIGNEE_REQUIRED")
  void start_manyOutside_required() {
    WorkflowModel many = startModel(List.of("a"), List.of("b", "c"));
    Resolution r = startWith(many, ids(A));
    assertThat(r.violation().code()).isEqualTo("WORKFLOW_ASSIGNEE_REQUIRED");
    assertThat(r.violation().errors())
        .containsEntry("role", "y")
        .containsEntry("candidates", "b,c");
  }

  /** start(assigneeRole x) → t(y). */
  private static WorkflowModel startModel(List<String> x, List<String> y) {
    return RunModels.model(
        List.of(role("x", x.toArray(String[]::new)), role("y", y.toArray(String[]::new))),
        List.of(byRole("x", "t")),
        start("start"),
        task("t", "y", out("done", "end", null)),
        end("end"));
  }

  @Test
  @DisplayName("게시본 Kim 이 나가고 kim 만 남으면 아무도 그 역할이 아니다")
  void departedMember_caseTwin_notResolved() {
    WorkflowModel model =
        RunModels.model(
            List.of(role("y", "Kim")),
            List.of(byRole("y", "t")),
            start("start"),
            task("t", "y", out("done", "end", null)),
            end("end"));
    RunRoleMembers m = RunRoleMembers.of(model, List.of(new ActiveMember(7L, "kim")));
    assertThat(m.members("y")).isEmpty();
    assertThat(m.ids("y")).isEmpty();
    assertThat(WorkflowRouting.start(model, ids(7L), m)).isEmpty();

    RunRoleMembers exact = RunRoleMembers.of(model, List.of(new ActiveMember(8L, "Kim")));
    assertThat(exact.ids("y")).containsExactly(8L);
  }

  @Test
  @DisplayName("options: 바로 task·keep·end·decision 의 candidates 와 required")
  void options_direct_keep_end_decision() {
    WorkflowModel model = model(List.of("b", "c"), List.of("b", "c"));
    RunRoleMembers m = members(model);
    Node from = model.nodes().get("from");
    RunState noPrev = state(model, list(B), ids(B), Map.of());
    RunState withPrev = state(model, list(B), ids(B), Map.of("t", list(C)));

    Options direct = AssigneeResolution.options(from, from.outcomes().get("direct"), noPrev, m);
    assertThat(direct.candidates()).containsExactly(B, C);
    assertThat(direct.required()).isTrue();

    Options keepNone = AssigneeResolution.options(from, from.outcomes().get("keep"), noPrev, m);
    assertThat(keepNone.candidates()).containsExactly(B, C);
    assertThat(keepNone.required()).isTrue();

    Options keepPrev = AssigneeResolution.options(from, from.outcomes().get("keep"), withPrev, m);
    assertThat(keepPrev.candidates()).containsExactly(C);
    assertThat(keepPrev.required()).isFalse();

    Options omit = AssigneeResolution.options(from, from.outcomes().get("omit"), noPrev, m);
    assertThat(omit.candidates()).containsExactly(B);
    assertThat(omit.required()).isFalse();

    Options toEnd = AssigneeResolution.options(from, from.outcomes().get("toEnd"), noPrev, m);
    assertThat(toEnd.candidates()).isEmpty();
    assertThat(toEnd.required()).isFalse();

    Options viaD = AssigneeResolution.options(from, from.outcomes().get("viaD"), noPrev, m);
    assertThat(viaD.candidates()).containsExactly(B, C);
    assertThat(viaD.required()).isNull();

    Options dKeep = AssigneeResolution.options(from, from.outcomes().get("dKeep"), noPrev, m);
    assertThat(dKeep.candidates()).isEmpty();
    assertThat(dKeep.required()).isNull();

    WorkflowModel single = model(List.of("a", "b"), List.of("b", "c"));
    Node from2 = single.nodes().get("from");
    Options one =
        AssigneeResolution.options(
            from2,
            from2.outcomes().get("direct"),
            state(single, list(A), ids(A), Map.of()),
            members(single));
    assertThat(one.candidates()).containsExactly(B);
    assertThat(one.required()).isFalse();
  }
}
