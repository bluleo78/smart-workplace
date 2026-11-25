package com.workplace.issue.workflow.service;

import com.workplace.global.dto.UserSummary;
import com.workplace.global.tenant.TenantContext;
import com.workplace.issue.workflow.domain.AssigneeResolution;
import com.workplace.issue.workflow.domain.AssigneeResolution.Options;
import com.workplace.issue.workflow.domain.NodeTypes;
import com.workplace.issue.workflow.domain.OutputRules;
import com.workplace.issue.workflow.domain.RunRoleMembers;
import com.workplace.issue.workflow.domain.RunState;
import com.workplace.issue.workflow.domain.WorkflowModel;
import com.workplace.issue.workflow.domain.WorkflowModel.Condition;
import com.workplace.issue.workflow.domain.WorkflowModel.Node;
import com.workplace.issue.workflow.domain.WorkflowModel.Outcome;
import com.workplace.issue.workflow.dto.IssueWorkflowView;
import com.workplace.issue.workflow.dto.IssueWorkflowView.NodeRunSummary;
import com.workplace.issue.workflow.dto.IssueWorkflowView.NodeView;
import com.workplace.issue.workflow.dto.IssueWorkflowView.OutcomeView;
import com.workplace.issue.workflow.dto.IssueWorkflowView.RequiredOutput;
import com.workplace.issue.workflow.repository.NodeRunRow;
import com.workplace.user.dto.AssigneeInfo;
import com.workplace.user.repository.UserRepository;
import java.time.Instant;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Deque;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

/**
 * 실행 view({@link IssueWorkflowView}) 조립(WP-1985). 조회·시작·이동·dryRun 이 같은 조립을 쓰도록 실행의 모습을 {@link
 * Snapshot} 하나로 받는다 — dryRun 은 저장하지 않은 계획을, 나머지는 DB 에서 다시 읽은 값을 넣는다.
 *
 * <p>사람 요약은 한 번의 조회로 모아 붙인다(목록 길이만큼 질의하지 않는다).
 */
@Component
@RequiredArgsConstructor
class WorkflowRunViews {

  private final UserRepository userRepository;

  /**
   * view 를 만들 실행의 모습.
   *
   * @param runId 실행 id(dryRun 이면 null)
   * @param model 실행이 고정한 게시본 모델(사본)
   * @param currentNode 지금 노드 키
   * @param nodeRuns 들어간 순서의 노드 방문(마지막 것이 지금 노드)
   * @param issueAssignees 지금 이슈 담당
   * @param context 실행 context
   * @param endedAt 실행이 끝난 시각(진행 중·dryRun 이면 null)
   */
  record Snapshot(
      Long runId,
      String status,
      int revision,
      long workflowId,
      int versionNo,
      WorkflowModel model,
      RunRoleMembers members,
      String currentNode,
      List<NodeRunRow> nodeRuns,
      List<Long> issueAssignees,
      boolean issueClosed,
      Map<String, Object> context,
      Instant endedAt) {}

  /**
   * 판정에 쓸 실행 상태 — 이동 판정과 view 의 후보 계산이 같은 값을 보게 여기 한 곳에서 만든다. {@code lastAssigneesByNode} 는 노드마다 가장
   * 최근 방문의 담당이고, 지금 노드의 방문도 들어간다(돌아오는 keep 이 같은 사람을 다시 고르는 근거).
   */
  static RunState stateOf(Snapshot s) {
    NodeRunRow current = currentVisit(s);
    Map<String, List<Long>> last = new LinkedHashMap<>();
    for (NodeRunRow r : s.nodeRuns()) {
      last.put(r.nodeKey(), r.assigneeIds());
    }
    return new RunState(
        s.model(),
        s.status(),
        s.revision(),
        s.issueClosed(),
        s.currentNode(),
        current == null ? null : current.status(),
        current == null ? List.of() : current.assigneeIds(),
        new LinkedHashSet<>(s.issueAssignees()),
        last,
        s.context());
  }

  /** 지금 노드의 방문 — 그 노드 키를 가진 가장 최근 방문(없으면 null). */
  static NodeRunRow currentVisit(Snapshot s) {
    return NodeRunRow.latestVisit(s.nodeRuns(), s.currentNode());
  }

  /** 지금 노드의 결과 하나와 그 결과의 담당 후보 — 결과 순서대로 한 목록에 둔다. */
  private record OutcomeOptions(Outcome outcome, Options options) {}

  /** view 를 조립한다. */
  IssueWorkflowView build(Snapshot s) {
    RunState state = stateOf(s);
    WorkflowModel model = s.model();
    NodeRunRow current = currentVisit(s);
    Node node = s.currentNode() == null ? null : model.nodes().get(s.currentNode());

    // 결과별 후보를 먼저 계산해 사람 id 를 모은 뒤 한 번에 요약한다.
    List<OutcomeOptions> choices = new ArrayList<>();
    if (node != null && state.isActive() && NodeTypes.isTask(node)) {
      for (Outcome o : node.outcomes().values()) {
        choices.add(new OutcomeOptions(o, AssigneeResolution.options(node, o, state, s.members())));
      }
    }
    Set<Long> ids = new LinkedHashSet<>();
    if (current != null) {
      ids.addAll(current.assigneeIds());
    }
    choices.forEach(c -> ids.addAll(c.options().candidates()));
    List<NodeRunRow> passed = passedVisits(s, current);
    passed.forEach(
        r -> {
          if (r.actorId() != null) {
            ids.add(r.actorId());
          }
        });
    Map<Long, UserSummary> users = users(ids);

    NodeView nodeView =
        node == null
            ? null
            : new NodeView(
                node.key(),
                node.name(),
                node.type(),
                node.roleKey(),
                current == null ? List.of() : summaries(current.assigneeIds(), users),
                current == null ? null : current.enteredAt(),
                current == null ? null : current.status(),
                node.instructions(),
                node.returnTo());

    List<OutcomeView> outcomeViews = new ArrayList<>();
    for (OutcomeOptions c : choices) {
      Outcome o = c.outcome();
      Options opt = c.options();
      outcomeViews.add(
          new OutcomeView(
              o.key(),
              o.to(),
              requiredOutputs(model, node, o),
              o.requireComment(),
              o.assignTo(),
              summaries(opt.candidates(), users),
              opt.required()));
    }

    List<NodeRunSummary> path = new ArrayList<>();
    for (NodeRunRow r : passed) {
      Node n = model.nodes().get(r.nodeKey());
      path.add(
          new NodeRunSummary(
              r.nodeKey(),
              n == null ? null : n.name(),
              r.outcome(),
              user(r.actorId(), users),
              r.enteredAt(),
              r.leftAt()));
    }

    return new IssueWorkflowView(
        s.runId(),
        s.status(),
        s.revision(),
        s.workflowId(),
        s.versionNo(),
        nodeView,
        List.copyOf(outcomeViews),
        List.copyOf(path),
        state.isActive() ? remaining(model, s.currentNode()) : List.of(),
        s.context(),
        s.endedAt());
  }

  /** 지나온 방문 — 지금 노드의 방문을 뺀 나머지(들어간 순서). */
  private static List<NodeRunRow> passedVisits(Snapshot s, NodeRunRow current) {
    // 같은 객체인지(identity)로 뺀다 — 같은 값의 다른 방문은 남긴다.
    return s.nodeRuns().stream().filter(r -> r != current).toList();
  }

  /** 꼭 내놓아야 할 값 — 질문 결과는 묻지 않으므로 빈 목록(설계 §7). */
  private static List<RequiredOutput> requiredOutputs(WorkflowModel model, Node from, Outcome o) {
    if (OutputRules.isQuestion(model, from, o)) {
      return List.of();
    }
    List<RequiredOutput> out = new ArrayList<>();
    from.outputs()
        .forEach(
            (key, spec) -> {
              if (spec.required()) {
                out.add(new RequiredOutput(key, spec.type()));
              }
            });
    return List.copyOf(out);
  }

  /**
   * end 까지 남은 기본 경로 — 지금 노드에서 BFS 최단 경로(지금 노드 제외, end 포함). 질문 경로(returnTo 가 있는 노드로 가는 결과)와 onError
   * 는 따르지 않고, 동률은 정의 순서(결과·조건·default 순)로 정한다. 닿을 수 없으면 빈 목록.
   */
  static List<String> remaining(WorkflowModel model, String from) {
    if (from == null || !model.nodes().containsKey(from)) {
      return List.of();
    }
    Map<String, String> parent = new HashMap<>();
    // 방문 여부만 본다(순서는 queue 가 정한다).
    Set<String> seen = new HashSet<>();
    Deque<String> queue = new ArrayDeque<>();
    seen.add(from);
    queue.add(from);
    String found = null;
    while (!queue.isEmpty()) {
      String key = queue.poll();
      Node n = model.nodes().get(key);
      if (n != null && "end".equals(n.type()) && !key.equals(from)) {
        found = key;
        break;
      }
      for (String next : nextKeys(model, n)) {
        if (next != null && model.nodes().containsKey(next) && seen.add(next)) {
          parent.put(next, key);
          queue.add(next);
        }
      }
    }
    if (found == null) {
      return List.of();
    }
    List<String> path = new ArrayList<>();
    for (String k = found; !k.equals(from); k = parent.get(k)) {
      path.add(k);
    }
    Collections.reverse(path);
    return List.copyOf(path);
  }

  /** 노드에서 나가는 기본 간선(정의 순서) — 질문 경로는 뺀다. */
  private static List<String> nextKeys(WorkflowModel model, Node n) {
    List<String> out = new ArrayList<>();
    if (n == null) {
      return out;
    }
    if (NodeTypes.START.equals(n.type())) {
      for (Condition c : model.start()) {
        out.add(c.to());
      }
    }
    for (Outcome o : n.outcomes().values()) {
      Node target = o.to() == null ? null : model.nodes().get(o.to());
      if (target != null && target.returnTo() != null) {
        continue;
      }
      out.add(o.to());
    }
    for (Condition c : n.conditions()) {
      out.add(c.to());
    }
    if (n.defaultTo() != null) {
      out.add(n.defaultTo());
    }
    return out;
  }

  /** id → 사람 요약(한 번의 조회). 사용자 행이 없으면 빠진다. */
  Map<Long, UserSummary> users(Set<Long> ids) {
    if (ids.isEmpty()) {
      return Map.of();
    }
    Map<Long, UserSummary> out = new HashMap<>();
    for (AssigneeInfo u : userRepository.findAssigneeInfos(ids, TenantContext.get())) {
      out.put(u.id(), new UserSummary(u.id(), u.username(), u.name(), u.kind()));
    }
    return out;
  }

  /** id 하나의 요약(id 가 null 이거나 사용자 행이 없으면 null). 실행 조회({@link WorkflowRunQueryService})도 같이 쓴다. */
  static UserSummary user(Long id, Map<Long, UserSummary> users) {
    return id == null ? null : users.get(id);
  }

  /** id 순서대로 요약(행이 없는 사람은 건너뜀). 실행 조회({@link WorkflowRunQueryService})도 같이 쓴다. */
  static List<UserSummary> summaries(List<Long> ids, Map<Long, UserSummary> users) {
    List<UserSummary> out = new ArrayList<>();
    for (Long id : ids) {
      UserSummary u = users.get(id);
      if (u != null) {
        out.add(u);
      }
    }
    return List.copyOf(out);
  }
}
