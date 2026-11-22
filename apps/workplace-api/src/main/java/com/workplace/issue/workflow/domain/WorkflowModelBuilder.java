package com.workplace.issue.workflow.domain;

import java.time.Duration;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.yaml.snakeyaml.nodes.MappingNode;
import org.yaml.snakeyaml.nodes.Node;
import org.yaml.snakeyaml.nodes.NodeTuple;
import org.yaml.snakeyaml.nodes.ScalarNode;
import org.yaml.snakeyaml.nodes.SequenceNode;

/**
 * 형태 검사를 통과한 Node 트리를 {@link WorkflowModel} 로 옮긴다(use 합치기·ask 펼치기 포함).
 *
 * <p>왜: 형태(키 이름·타입)는 스키마 검사가 보장하므로 여기서는 값만 옮긴다. 형태가 틀린 문서는 이 클래스에 오지 않는다. 다만 스키마가 말할 수 없는 값 검사 둘 —
 * 기간(ISO-8601·0 초과)과 maxVisits 범위 — 는 {@link #checkValues} 가 형태 오류와 같은 때에 함께 모아 알린다.
 */
final class WorkflowModelBuilder {

  /**
   * 문서 전체에서 펼친 instructions 의 합계 상한(UTF-16 단위). use 가 같은 공용 지시를 수만 번 잇는 문서가 힙을 채우지 못하게 하고, 저장한 모델
   * JSON 이 읽기 한도 아래에 머물게 한다.
   */
  static final long MAX_EXPANDED_CHARS = 1_048_576L;

  /** ask 줄임이 만드는 질문 노드의 기본 기한. */
  private static final Duration ASK_TIMEOUT = Duration.ofDays(1);

  private WorkflowModelBuilder() {}

  /** 기간 글을 읽는다. 0 이하·형식 오류면 null. */
  static Duration parseDuration(String text) {
    try {
      Duration d = Duration.parse(text);
      return d.isNegative() || d.isZero() ? null : d;
    } catch (DateTimeParseException | ArithmeticException e) {
      return null;
    }
  }

  /** 형태가 어긋났을 수 있는 트리에서 기간과 maxVisits 값을 느슨하게 확인한다(없거나 모양이 틀리면 건너뜀). */
  static void checkValues(Node root, ParseSession s) {
    Node nodes = field(root, "nodes");
    if (!(nodes instanceof MappingNode nodeMap)) {
      return;
    }
    for (NodeTuple t : nodeMap.getValue()) {
      if (!(t.getKeyNode() instanceof ScalarNode key)) {
        continue;
      }
      Node timeout = field(t.getValueNode(), "timeout");
      if (field(timeout, "after") instanceof ScalarNode after
          && YamlScalars.kind(after) != YamlScalars.Kind.NULL
          && parseDuration(after.getValue()) == null) {
        s.errorAt(
            "DURATION_INVALID",
            () ->
                "기간 '"
                    + ParseSession.clip(after.getValue())
                    + "' 을(를) 읽을 수 없습니다. 0 보다 긴 ISO-8601 기간(예: PT48H, P2D)으로 적어 주세요.",
            List.of("nodes", key.getValue(), "timeout", "after"));
      }
      if (field(t.getValueNode(), "maxVisits") instanceof ScalarNode mv
          && YamlScalars.kind(mv) == YamlScalars.Kind.INT
          && Long.parseLong(mv.getValue()) > Integer.MAX_VALUE) {
        s.errorAt(
            "SCHEMA_VALUE",
            () -> "nodes." + ParseSession.clip(key.getValue()) + ".maxVisits: 값이 너무 큽니다.",
            List.of("nodes", key.getValue(), "maxVisits"));
      }
    }
  }

  /** 모델을 만든다. ask 충돌 등 값 문제는 세션에 담고, 그때는 반환값을 쓰지 않는다. */
  static WorkflowModel build(MappingNode root, ParseSession s) {
    Map<String, Node> top = entries(root);

    Map<String, WorkflowModel.Role> roles = new LinkedHashMap<>();
    entries(top.get("roles"))
        .forEach(
            (k, v) -> {
              Map<String, Node> f = entries(v);
              roles.put(
                  k, new WorkflowModel.Role(k, str(f.get("name")), strings(f.get("members"))));
            });

    Map<String, String> shared = new LinkedHashMap<>();
    entries(top.get("shared")).forEach((k, v) -> shared.put(k, str(v)));

    Map<String, Node> rawNodes = entries(top.get("nodes"));
    LinkedHashMap<String, WorkflowModel.Node> nodes = new LinkedHashMap<>();
    long[] expanded = new long[1];
    for (Map.Entry<String, Node> e : rawNodes.entrySet()) {
      buildNode(e.getKey(), e.getValue(), shared, rawNodes, nodes, expanded, s);
    }

    List<WorkflowModel.Condition> start = new ArrayList<>();
    if (top.get("start") instanceof SequenceNode seq) {
      seq.getValue().forEach(c -> start.add(condition(c)));
    }

    Map<String, WorkflowModel.Point> layout = new LinkedHashMap<>();
    entries(top.get("layout"))
        .forEach(
            (k, v) -> {
              Map<String, Node> f = entries(v);
              layout.put(
                  k,
                  new WorkflowModel.Point(
                      Double.parseDouble(str(f.get("x"))), Double.parseDouble(str(f.get("y")))));
            });

    return new WorkflowModel(
        str(top.get("schema")), str(top.get("name")), roles, shared, nodes, start, layout);
  }

  /** 노드 하나를 만들어 nodes 에 넣고, agent_task 의 ask 줄임이면 바로 뒤에 질문 노드를 펼친다. */
  private static void buildNode(
      String key,
      Node raw,
      Map<String, String> shared,
      Map<String, Node> rawNodes,
      LinkedHashMap<String, WorkflowModel.Node> nodes,
      long[] expanded,
      ParseSession s) {
    Map<String, Node> f = entries(raw);
    String type = str(f.get("type"));

    LinkedHashMap<String, WorkflowModel.Outcome> outcomes = new LinkedHashMap<>();
    entries(f.get("outcomes"))
        .forEach(
            (k, v) -> {
              Map<String, Node> o = entries(v);
              outcomes.put(
                  k,
                  new WorkflowModel.Outcome(
                      k, str(o.get("to")), str(o.get("assignTo")), bool(o.get("requireComment"))));
            });

    String askRole = null;
    String askKey = key + "_ask";
    if ("agent_task".equals(type) && f.containsKey("ask")) {
      List<String> askPath = List.of("nodes", key, "ask");
      if (askKey.length() > ParseSession.MAX_NODE_KEY) {
        // 펼친 키는 스키마의 키 검사를 지나지 않는다 — 여기서 막지 않으면 저장 모델·문제의 nodeKey 가 100자 계약을 어긴다.
        s.errorAt(
            "ASK_KEY_TOO_LONG",
            "ask 줄임이 만들 노드 키(<키>_ask)가 100자를 넘습니다. 이 노드의 키를 96자 이하로 줄여 주세요.",
            askPath);
      } else if (rawNodes.containsKey(askKey)) {
        s.errorAt(
            "ASK_CONFLICT",
            () ->
                "ask 줄임이 만들 노드 '"
                    + ParseSession.clip(askKey)
                    + "' 가 이미 있습니다. ask 를 지우거나 노드 이름을 바꿔 주세요.",
            askPath);
      } else if (outcomes.containsKey("ask")) {
        s.errorAt(
            "ASK_CONFLICT", "ask 줄임이 만들 결과 'ask' 가 이미 있습니다. ask 줄임을 지우거나 결과 이름을 바꿔 주세요.", askPath);
      } else {
        askRole = str(entries(f.get("ask")).get("role"));
        outcomes.put("ask", new WorkflowModel.Outcome("ask", askKey, askRole, true));
      }
    }

    Map<String, WorkflowModel.OutputSpec> outputs = new LinkedHashMap<>();
    entries(f.get("outputs"))
        .forEach(
            (k, v) -> {
              Map<String, Node> o = entries(v);
              outputs.put(
                  k, new WorkflowModel.OutputSpec(str(o.get("type")), bool(o.get("required"))));
            });

    List<WorkflowModel.Condition> conditions = new ArrayList<>();
    if (f.get("conditions") instanceof SequenceNode seq) {
      seq.getValue().forEach(c -> conditions.add(condition(c)));
    }

    List<String> use = strings(f.get("use"));
    nodes.put(
        key,
        new WorkflowModel.Node(
            key,
            type,
            str(f.get("name")),
            str(f.get("role")),
            composeInstructions(key, use, shared, str(f.get("instructions")), expanded, s),
            use,
            strings(f.get("requires")),
            outputs,
            outcomes,
            conditions,
            str(f.get("default")),
            f.get("maxVisits") == null ? null : Integer.valueOf(str(f.get("maxVisits"))),
            timeout(f.get("timeout")),
            target(f.get("onError")),
            str(f.get("returnTo"))));

    if (askRole != null) {
      expandAsk(key, askKey, str(f.get("name")), askRole, nodes, s);
    }
  }

  /** ask 줄임의 질문 노드를 만들어 원 노드 바로 뒤에 넣고, 펼친 모든 경로의 위치를 ask 줄로 등록한다. */
  private static void expandAsk(
      String key,
      String askKey,
      String name,
      String role,
      LinkedHashMap<String, WorkflowModel.Node> nodes,
      ParseSession s) {
    LinkedHashMap<String, WorkflowModel.Outcome> answered = new LinkedHashMap<>();
    answered.put("answered", new WorkflowModel.Outcome("answered", key, "keep", true));
    nodes.put(
        askKey,
        new WorkflowModel.Node(
            askKey,
            "human_task",
            (name == null ? key : name) + " 질문 답변",
            role,
            null,
            List.of(),
            List.of(),
            Map.of(),
            answered,
            List.of(),
            null,
            null,
            new WorkflowModel.Timeout(ASK_TIMEOUT, "remind"),
            null,
            key));

    SourceMap.Pos pos = s.source.at(List.of("nodes", key, "ask"));
    for (String field :
        List.of(
            "",
            "type",
            "name",
            "role",
            "returnTo",
            "timeout",
            "timeout.after",
            "timeout.then",
            "outcomes",
            "outcomes.answered",
            "outcomes.answered.to",
            "outcomes.answered.assignTo",
            "outcomes.answered.requireComment")) {
      List<String> path = new ArrayList<>(List.of("nodes", askKey));
      if (!field.isEmpty()) {
        path.addAll(List.of(field.split("\\.")));
      }
      s.source.put(path, pos);
    }
    for (String field : List.of("", "to", "assignTo", "requireComment")) {
      List<String> path = new ArrayList<>(List.of("nodes", key, "outcomes", "ask"));
      if (!field.isEmpty()) {
        path.add(field);
      }
      s.source.put(path, pos);
    }
    List<String> outcomesPath = List.of("nodes", key, "outcomes");
    if (!s.source.has(outcomesPath)) {
      s.source.put(outcomesPath, pos);
    }
  }

  /**
   * use 순서의 shared 글과 노드 지시를 빈 줄로 잇는다(없는 이름은 건너뜀, 아무것도 없으면 null). 잇기 전에 길이만 더해 문서 합계 상한을 판정하고, 넘으면
   * ERROR 를 담은 뒤 이 노드와 이후 노드는 아무것도 잇지 않는다(메모리를 쓰기 전에 멈춘다).
   */
  private static String composeInstructions(
      String key,
      List<String> use,
      Map<String, String> shared,
      String own,
      long[] expanded,
      ParseSession s) {
    List<String> parts = new ArrayList<>();
    long length = 0;
    for (String name : use) {
      String text = shared.get(name);
      if (text != null) {
        parts.add(text);
        length += text.length();
      }
    }
    if (own != null) {
      parts.add(own);
      length += own.length();
    }
    if (parts.isEmpty()) {
      return null;
    }
    length += 2L * (parts.size() - 1);
    if (expanded[0] > MAX_EXPANDED_CHARS || expanded[0] + length > MAX_EXPANDED_CHARS) {
      if (expanded[0] <= MAX_EXPANDED_CHARS) {
        s.errorAt(
            "YAML_EXPANSION_TOO_LARGE",
            "use 로 펼친 지시의 문서 전체 합계가 너무 큽니다(최대 " + MAX_EXPANDED_CHARS + "자). 공용 지시를 덜 반복해 주세요.",
            List.of("nodes", key, "use"));
        expanded[0] = MAX_EXPANDED_CHARS + 1;
      }
      return null;
    }
    expanded[0] += length;
    return String.join("\n\n", parts);
  }

  /** {when, to} 한 건을 조건으로 옮긴다. */
  private static WorkflowModel.Condition condition(Node node) {
    Map<String, Node> f = entries(node);
    Map<String, Node> when = entries(f.get("when"));
    String to = str(f.get("to"));
    if (when.containsKey("assigneeRole")) {
      return new WorkflowModel.Condition(str(when.get("assigneeRole")), null, null, to);
    }
    Object value = when.get("equals") instanceof ScalarNode sc ? YamlScalars.typedValue(sc) : null;
    return new WorkflowModel.Condition(null, str(when.get("context")), value, to);
  }

  /** timeout 을 옮긴다(없으면 null). */
  private static WorkflowModel.Timeout timeout(Node node) {
    if (node == null) {
      return null;
    }
    Map<String, Node> f = entries(node);
    return new WorkflowModel.Timeout(parseDuration(str(f.get("after"))), str(f.get("then")));
  }

  /** onError 를 옮긴다(없으면 null). */
  private static WorkflowModel.Target target(Node node) {
    if (node == null) {
      return null;
    }
    Map<String, Node> f = entries(node);
    return new WorkflowModel.Target(str(f.get("to")), str(f.get("assignTo")));
  }

  /** 맵 노드의 하위 필드 하나(없거나 맵이 아니면 null). */
  private static Node field(Node node, String name) {
    return node instanceof MappingNode ? entries(node).get(name) : null;
  }

  /** 맵 노드를 키 순서 그대로 {키 글 → 값 노드} 로 편다(맵이 아니면 빈 맵). */
  private static Map<String, Node> entries(Node node) {
    Map<String, Node> out = new LinkedHashMap<>();
    if (node instanceof MappingNode m) {
      for (NodeTuple t : m.getValue()) {
        if (t.getKeyNode() instanceof ScalarNode k) {
          out.put(k.getValue(), t.getValueNode());
        }
      }
    }
    return out;
  }

  /** 스칼라의 적힌 글(없거나 null 스칼라면 null). */
  private static String str(Node node) {
    return node instanceof ScalarNode s && YamlScalars.kind(s) != YamlScalars.Kind.NULL
        ? s.getValue()
        : null;
  }

  /** 불리언 칸(없으면 false). */
  private static boolean bool(Node node) {
    return "true".equals(str(node));
  }

  /** 글 목록(없으면 빈 목록). */
  private static List<String> strings(Node node) {
    List<String> out = new ArrayList<>();
    if (node instanceof SequenceNode seq) {
      seq.getValue().forEach(n -> out.add(str(n)));
    }
    return out;
  }
}
