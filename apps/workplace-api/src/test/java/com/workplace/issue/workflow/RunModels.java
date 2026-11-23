package com.workplace.issue.workflow;

import com.workplace.issue.workflow.domain.ActiveMember;
import com.workplace.issue.workflow.domain.RunRoleMembers;
import com.workplace.issue.workflow.domain.RunState;
import com.workplace.issue.workflow.domain.WorkflowModel;
import com.workplace.issue.workflow.domain.WorkflowModel.Condition;
import com.workplace.issue.workflow.domain.WorkflowModel.Node;
import com.workplace.issue.workflow.domain.WorkflowModel.Outcome;
import com.workplace.issue.workflow.domain.WorkflowModel.OutputSpec;
import com.workplace.issue.workflow.domain.WorkflowModel.Role;
import com.workplace.issue.workflow.domain.WorkflowYamlParser;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * 실행 판정 테스트(MoveRules·WorkflowRouting·AssigneeResolution)가 함께 쓰는 정의·구성원·상태 만들기(WP-1985).
 *
 * <p>왜: 예시 정의(spec-example.yaml)에는 decision 이 없어 decision·연쇄·역할 교집합 경우는 모델을 직접 만들어야 한다. 노드 생성자는 필드가
 * 많아 테스트마다 쓰면 읽기 어렵다.
 */
final class RunModels {

  /** 예시 정의 구성원의 id — 역할 순서대로. */
  static final long LEAD = 1L;

  static final long PLANNER = 2L;
  static final long DEV1 = 3L;
  static final long DEV2 = 4L;
  static final long OWNER = 5L;

  private RunModels() {}

  /** 예시 정의(spec-example.yaml)를 파서로 읽은 모델. */
  static WorkflowModel spec() {
    try {
      String yaml =
          Files.readString(
              Path.of("src/test/resources/workflow/spec-example.yaml"), StandardCharsets.UTF_8);
      return WorkflowYamlParser.parse(yaml).model();
    } catch (IOException e) {
      throw new UncheckedIOException(e);
    }
  }

  /** 예시 정의의 구성원이 모두 지금 활성인 표. */
  static RunRoleMembers specMembers(WorkflowModel model) {
    return RunRoleMembers.of(
        model,
        List.of(
            new ActiveMember(LEAD, "teamleader@iacloud.kr"),
            new ActiveMember(PLANNER, "planner@iacloud.kr"),
            new ActiveMember(DEV1, "dev1@example.com"),
            new ActiveMember(DEV2, "dev2@example.com"),
            new ActiveMember(OWNER, "owner@example.com")));
  }

  /** 노드 하나의 outputs 만 바꾼 모델 사본. */
  static WorkflowModel withOutputs(
      WorkflowModel model, String nodeKey, Map<String, OutputSpec> outputs) {
    LinkedHashMap<String, Node> nodes = new LinkedHashMap<>(model.nodes());
    Node n = nodes.get(nodeKey);
    nodes.put(
        nodeKey,
        new Node(
            n.key(),
            n.type(),
            n.name(),
            n.roleKey(),
            n.instructions(),
            n.use(),
            n.requires(),
            outputs,
            n.outcomes(),
            n.conditions(),
            n.defaultTo(),
            n.maxVisits(),
            n.timeout(),
            n.onError(),
            n.returnTo()));
    return new WorkflowModel(
        model.schema(), model.name(), model.roles(), model.shared(), nodes, model.start(), null);
  }

  /** 역할. */
  static Role role(String key, String... usernames) {
    return new Role(key, key, List.of(usernames));
  }

  /** 결과 이동. */
  static Outcome out(String key, String to, String assignTo) {
    return new Outcome(key, to, assignTo, false);
  }

  /** assigneeRole 조건. */
  static Condition byRole(String role, String to) {
    return new Condition(role, null, null, to);
  }

  /** context 조건. */
  static Condition byContext(String context, Object equalsValue, String to) {
    return new Condition(null, context, equalsValue, to);
  }

  /** start 노드. */
  static Node start(String key) {
    return node(key, "start", null, List.of(), List.of(), null);
  }

  /** end 노드. */
  static Node end(String key) {
    return node(key, "end", null, List.of(), List.of(), null);
  }

  /** agent_task 노드. */
  static Node task(String key, String role, Outcome... outcomes) {
    return node(key, "agent_task", role, List.of(outcomes), List.of(), null);
  }

  /** decision 노드. */
  static Node decision(String key, String defaultTo, Condition... conditions) {
    return node(key, "decision", null, List.of(), List.of(conditions), defaultTo);
  }

  private static Node node(
      String key,
      String type,
      String role,
      List<Outcome> outcomes,
      List<Condition> conditions,
      String defaultTo) {
    LinkedHashMap<String, Outcome> map = new LinkedHashMap<>();
    outcomes.forEach(o -> map.put(o.key(), o));
    return new Node(
        key,
        type,
        key,
        role,
        null,
        List.of(),
        List.of(),
        Map.of(),
        map,
        conditions,
        defaultTo,
        null,
        null,
        null,
        null);
  }

  /** 역할·start 조건·노드로 모델을 만든다(노드는 적은 순서). */
  static WorkflowModel model(List<Role> roles, List<Condition> start, Node... nodes) {
    Map<String, Role> roleMap = new LinkedHashMap<>();
    roles.forEach(r -> roleMap.put(r.key(), r));
    LinkedHashMap<String, Node> nodeMap = new LinkedHashMap<>();
    for (Node n : nodes) {
      nodeMap.put(n.key(), n);
    }
    return new WorkflowModel("genia/workflow@1", "t", roleMap, Map.of(), nodeMap, start, null);
  }

  /** 지금 상태 — 활성(RUNNING)·노드 ACTIVE 기본값. */
  static RunState state(
      WorkflowModel model,
      String currentNode,
      int revision,
      List<Long> nodeAssignees,
      Set<Long> issueAssignees,
      Map<String, List<Long>> lastAssigneesByNode,
      Map<String, Object> context) {
    return new RunState(
        model,
        RunState.RUNNING,
        revision,
        false,
        currentNode,
        RunState.NODE_ACTIVE,
        nodeAssignees,
        issueAssignees,
        lastAssigneesByNode,
        context);
  }

  /** 순서를 지킨 집합. */
  static Set<Long> ids(Long... ids) {
    return new LinkedHashSet<>(List.of(ids));
  }

  /** 순서를 지킨 가변 목록. */
  static List<Long> list(Long... ids) {
    return new ArrayList<>(List.of(ids));
  }
}
