package com.workplace.issue.workflow.domain;

import com.workplace.global.util.PersonNames;
import com.workplace.issue.workflow.domain.AssigneeResolution.Resolution;
import com.workplace.issue.workflow.domain.WorkflowModel.Node;
import com.workplace.issue.workflow.domain.WorkflowModel.Outcome;
import com.workplace.issue.workflow.domain.WorkflowRouting.Route;
import com.workplace.issue.workflow.dto.MoveRequest;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;

/**
 * 노드 이동 판정(설계 §7 의 4~8). DB·Spring 없는 순수 함수.
 *
 * <p>왜: 서비스는 이슈 행을 잠근 뒤 이 판정만 부르고, 통과하면 {@link #plan} 이 낸 같은 연쇄·담당을 저장한다 — 검증과 저장이 다른 계산을 하면 「검증은
 * dev1, 저장은 dev2」 같은 어긋남이 생긴다(원장 R1).
 */
public final class MoveRules {

  private MoveRules() {}

  /**
   * 이동 계획 — 기준 사람·연쇄·담당을 한 번에 계산한 값. check 와 저장이 같은 것을 쓴다.
   *
   * @param basis assigneeRole 판정의 기준 사람들(§8)
   * @param route 자동 연쇄 결과
   * @param resolution 머무는 노드의 담당(위반이 있으면 violation)
   * @param context 이번 출력을 떠나는 노드 아래 덮은 context — 저장(§9)도 이 값을 그대로 쓴다(덮는 규칙을 다시 쓰지 않게, 원장 R1)
   */
  public record MovePlan(
      List<Long> basis, Route route, Resolution resolution, Map<String, Object> context) {
    /** 기준 목록·context 를 불변으로. */
    public MovePlan {
      basis = List.copyOf(basis);
      context = Collections.unmodifiableMap(new LinkedHashMap<>(context));
    }
  }

  /**
   * 판정. §7 순서로 보고 4~7 에서 걸리면 그 하나만 돌려준다. 8(결과·출력·의견·담당)은 위반을 모두 모은다. 서비스는 첫 위반으로 응답한다.
   *
   * @param from 요청 fromNode 의 노드(없으면 null)
   * @param outcome from 의 요청 결과(없으면 null)
   * @return 위반 목록(빈 목록이면 통과)
   */
  public static List<MoveViolation> check(
      Node from,
      Outcome outcome,
      MoveRequest request,
      RunState state,
      MoveActor actor,
      RunRoleMembers members) {
    // 4. 끝났거나 이슈가 닫힘
    if (!state.isActive() || state.issueClosed()) {
      return List.of(MoveViolation.notActive());
    }
    // 5. 본 노드·revision 이 지금과 다름(revision 이 빠졌으면 다른 것으로 본다)
    if (!Objects.equals(request.fromNode(), state.currentNode())
        || request.expectedRevision() == null
        || request.expectedRevision() != state.revision()) {
      return List.of(MoveViolation.stale(state.currentNode(), state.revision()));
    }
    // 6. 멈춤
    if (state.isSuspended()) {
      return List.of(MoveViolation.nodeSuspended());
    }
    // 7. 담당·관리자 아님
    if (!actor.isAssignee(state) && !actor.manager()) {
      return List.of(MoveViolation.notAssignee());
    }
    // 8. 결과 — 모르면 출력·의견·담당을 판단할 근거가 없어 여기서 멈춘다.
    if (from == null
        || outcome == null
        || !outcome.equals(from.outcomes().get(request.outcome()))) {
      return List.of(MoveViolation.unknownOutcome());
    }
    List<MoveViolation> violations =
        new ArrayList<>(OutputRules.check(state.model(), from, outcome, request.outputs()));
    // 의견 없음 = 그려지는 글자가 없음 — 댓글 API 의 @VisibleText(WP-777)와 같은 기준이라 제로폭만 있는 빈 댓글이 생기지 않는다.
    if (outcome.requireComment()
        && (request.comment() == null || !PersonNames.hasVisibleChar(request.comment()))) {
      violations.add(MoveViolation.commentRequired());
    }
    Resolution resolution = plan(from, outcome, request, state, members).resolution();
    if (resolution.violation() != null) {
      violations.add(resolution.violation());
    }
    return violations;
  }

  /**
   * 이동 계획 — 기준 사람(§8) → 연쇄 → 담당(§7 표). 연쇄의 context 는 이번 출력을 떠나는 노드 아래에 덮은 사본이다(저장 뒤 context 와 같은
   * 값으로 decision 이 판정하게).
   */
  public static MovePlan plan(
      Node from, Outcome outcome, MoveRequest request, RunState state, RunRoleMembers members) {
    List<Long> basis =
        AssigneeResolution.routingBasis(outcome, request.assigneeIds(), state, members);
    Map<String, Object> context =
        contextWithOutputs(state.context(), from.key(), request.outputs());
    Route route = WorkflowRouting.route(state.model(), outcome.to(), basis, context, members);
    Resolution resolution =
        AssigneeResolution.forMove(outcome, route, request.assigneeIds(), state, members);
    return new MovePlan(basis, route, resolution, context);
  }

  /**
   * 지금 노드와 요청 결과로 찾아 계획한다(조회·테스트용 편의). 노드·결과가 없으면 {@link IllegalArgumentException} — 먼저 {@link
   * #check} 로 걸러야 한다.
   */
  public static MovePlan plan(MoveRequest request, RunState state, RunRoleMembers members) {
    Node from = state.model().nodes().get(state.currentNode());
    Outcome outcome = from == null ? null : from.outcomes().get(request.outcome());
    if (outcome == null) {
      throw new IllegalArgumentException("지금 노드에 없는 결과로는 계획할 수 없다");
    }
    return plan(from, outcome, request, state, members);
  }

  /** context 사본에 이번 출력(값이 null 이 아닌 키만)을 노드 아래 덮는다. 원본은 바꾸지 않는다. */
  static Map<String, Object> contextWithOutputs(
      Map<String, Object> context, String nodeKey, Map<String, Object> outputs) {
    if (outputs == null || outputs.isEmpty()) {
      return context;
    }
    Map<String, Object> copy = new LinkedHashMap<>(context);
    Map<String, Object> node = new LinkedHashMap<>();
    if (context.get(nodeKey) instanceof Map<?, ?> previous) {
      previous.forEach((k, v) -> node.put(String.valueOf(k), v));
    }
    outputs.forEach(
        (k, v) -> {
          if (k != null && v != null) {
            node.put(k, v);
          }
        });
    copy.put(nodeKey, node);
    return copy;
  }
}
