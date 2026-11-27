package com.workplace.issue.workflow.domain;

import com.workplace.global.json.JsonMappers;
import java.time.Duration;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.node.ArrayNode;
import tools.jackson.databind.node.ObjectNode;

/**
 * 모델 ↔ 저장용 JSON 변환.
 *
 * <p>왜: JSONB 는 객체 키 순서를 보존하지 않는데 노드·결과의 적힌 순서는 뜻이다(화면 순서·「첫 조건」). 그래서 {@code nodes}·{@code
 * outcomes}·{@code roles}·{@code shared}·{@code layout}·노드의 {@code outputs} 는 모두 {@code key} 가 든
 * <b>배열</b>로 쓰고, 읽을 때 LinkedHashMap 으로 되살린다. 사용자가 정한 글을 JSON 필드 이름으로 쓰지 않는 이유는 하나 더 있다 — Jackson 은
 * 해시가 같은 필드 이름이 많으면(150개 초과 충돌) 읽기를 거절하므로, 충돌하는 이름을 일부러 만든 문서가 저장된 뒤 영영 읽히지 않게 된다. 기간은 ISO-8601
 * 문자열(예 PT48H)이다. 필드 이름은 모델 레코드의 이름과 같다. 값이 없는 필드는 쓰지 않고, 읽을 때 없으면 빈 값/null 이 된다.
 */
public final class WorkflowModelJson {

  private WorkflowModelJson() {}

  /** 모델을 JSON 글로 쓴다. */
  public static String write(WorkflowModel m) {
    ObjectNode root = JsonMappers.JACKSON2.createObjectNode();
    root.put("schema", m.schema());
    putIfPresent(root, "name", m.name());

    ArrayNode roles = root.putArray("roles");
    m.roles()
        .forEach(
            (k, r) -> {
              ObjectNode o = roles.addObject();
              o.put("key", k);
              putIfPresent(o, "name", r.name());
              ArrayNode members = o.putArray("memberUsernames");
              r.memberUsernames().forEach(members::add);
            });

    ArrayNode shared = root.putArray("shared");
    m.shared()
        .forEach(
            (k, text) -> {
              ObjectNode o = shared.addObject();
              o.put("key", k);
              o.put("text", text);
            });

    ArrayNode nodes = root.putArray("nodes");
    m.nodes().values().forEach(n -> nodes.add(writeNode(n)));

    ArrayNode start = root.putArray("start");
    m.start().forEach(c -> start.add(writeCondition(c)));

    ArrayNode layout = root.putArray("layout");
    m.layout()
        .forEach(
            (k, p) -> {
              ObjectNode o = layout.addObject();
              o.put("key", k);
              o.put("x", p.x());
              o.put("y", p.y());
            });
    return JsonMappers.JACKSON2.writeValueAsString(root);
  }

  /** JSON 글을 모델로 읽는다(쓴 순서 그대로). 형식이 틀리면 예외. */
  public static WorkflowModel read(String json) {
    JsonNode root = JsonMappers.JACKSON2.readTree(json);

    Map<String, WorkflowModel.Role> roles = new LinkedHashMap<>();
    for (JsonNode r : root.path("roles")) {
      roles.put(
          text(r, "key"),
          new WorkflowModel.Role(
              text(r, "key"), text(r, "name"), strings(r.path("memberUsernames"))));
    }
    Map<String, String> shared = new LinkedHashMap<>();
    for (JsonNode e : root.path("shared")) {
      shared.put(text(e, "key"), text(e, "text"));
    }
    LinkedHashMap<String, WorkflowModel.Node> nodes = new LinkedHashMap<>();
    for (JsonNode n : root.path("nodes")) {
      WorkflowModel.Node node = readNode(n);
      nodes.put(node.key(), node);
    }
    List<WorkflowModel.Condition> start = new ArrayList<>();
    for (JsonNode c : root.path("start")) {
      start.add(readCondition(c));
    }
    Map<String, WorkflowModel.Point> layout = new LinkedHashMap<>();
    for (JsonNode e : root.path("layout")) {
      layout.put(
          text(e, "key"), new WorkflowModel.Point(e.path("x").asDouble(), e.path("y").asDouble()));
    }
    return new WorkflowModel(
        text(root, "schema"), text(root, "name"), roles, shared, nodes, start, layout);
  }

  /** 노드 하나를 JSON 객체로 쓴다(결과는 배열). */
  private static ObjectNode writeNode(WorkflowModel.Node n) {
    ObjectNode o = JsonMappers.JACKSON2.createObjectNode();
    o.put("key", n.key());
    putIfPresent(o, "type", n.type());
    putIfPresent(o, "name", n.name());
    putIfPresent(o, "roleKey", n.roleKey());
    putIfPresent(o, "instructions", n.instructions());
    ArrayNode use = o.putArray("use");
    n.use().forEach(use::add);
    ArrayNode requires = o.putArray("requires");
    n.requires().forEach(requires::add);
    ArrayNode outputs = o.putArray("outputs");
    n.outputs()
        .forEach(
            (k, spec) -> {
              ObjectNode so = outputs.addObject();
              so.put("key", k);
              so.put("type", spec.type());
              so.put("required", spec.required());
              putIfPresent(so, "name", spec.name());
            });
    ArrayNode outcomes = o.putArray("outcomes");
    n.outcomes()
        .values()
        .forEach(
            oc -> {
              ObjectNode oo = outcomes.addObject();
              oo.put("key", oc.key());
              oo.put("to", oc.to());
              putIfPresent(oo, "assignTo", oc.assignTo());
              oo.put("requireComment", oc.requireComment());
              putIfPresent(oo, "name", oc.name());
            });
    ArrayNode conditions = o.putArray("conditions");
    n.conditions().forEach(c -> conditions.add(writeCondition(c)));
    putIfPresent(o, "defaultTo", n.defaultTo());
    if (n.maxVisits() != null) {
      o.put("maxVisits", n.maxVisits().intValue());
    }
    if (n.timeout() != null) {
      ObjectNode t = o.putObject("timeout");
      t.put("after", n.timeout().after().toString());
      putIfPresent(t, "then", n.timeout().then());
    }
    if (n.onError() != null) {
      ObjectNode t = o.putObject("onError");
      t.put("to", n.onError().to());
      putIfPresent(t, "assignTo", n.onError().assignTo());
    }
    putIfPresent(o, "returnTo", n.returnTo());
    return o;
  }

  /** JSON 객체를 노드로 읽는다. */
  private static WorkflowModel.Node readNode(JsonNode o) {
    Map<String, WorkflowModel.OutputSpec> outputs = new LinkedHashMap<>();
    for (JsonNode e : o.path("outputs")) {
      outputs.put(
          text(e, "key"),
          new WorkflowModel.OutputSpec(
              text(e, "type"), e.path("required").asBoolean(false), text(e, "name")));
    }
    LinkedHashMap<String, WorkflowModel.Outcome> outcomes = new LinkedHashMap<>();
    for (JsonNode oc : o.path("outcomes")) {
      outcomes.put(
          text(oc, "key"),
          new WorkflowModel.Outcome(
              text(oc, "key"),
              text(oc, "to"),
              text(oc, "assignTo"),
              oc.path("requireComment").asBoolean(false),
              text(oc, "name")));
    }
    List<WorkflowModel.Condition> conditions = new ArrayList<>();
    for (JsonNode c : o.path("conditions")) {
      conditions.add(readCondition(c));
    }
    WorkflowModel.Timeout timeout = null;
    if (o.hasNonNull("timeout")) {
      JsonNode t = o.get("timeout");
      timeout = new WorkflowModel.Timeout(Duration.parse(text(t, "after")), text(t, "then"));
    }
    WorkflowModel.Target onError = null;
    if (o.hasNonNull("onError")) {
      JsonNode t = o.get("onError");
      onError = new WorkflowModel.Target(text(t, "to"), text(t, "assignTo"));
    }
    return new WorkflowModel.Node(
        text(o, "key"),
        text(o, "type"),
        text(o, "name"),
        text(o, "roleKey"),
        text(o, "instructions"),
        strings(o.path("use")),
        strings(o.path("requires")),
        outputs,
        outcomes,
        conditions,
        text(o, "defaultTo"),
        o.hasNonNull("maxVisits") ? Integer.valueOf(o.get("maxVisits").asInt()) : null,
        timeout,
        onError,
        text(o, "returnTo"));
  }

  /** 조건을 쓴다. equalsValue 는 글·수·불리언을 JSON 타입으로 구분해 쓴다. */
  private static ObjectNode writeCondition(WorkflowModel.Condition c) {
    ObjectNode o = JsonMappers.JACKSON2.createObjectNode();
    putIfPresent(o, "assigneeRole", c.assigneeRole());
    putIfPresent(o, "contextKey", c.contextKey());
    Object v = c.equalsValue();
    if (v instanceof Boolean b) {
      o.put("equalsValue", b.booleanValue());
    } else if (v instanceof Double d) {
      o.put("equalsValue", d.doubleValue());
    } else if (v instanceof Number n) {
      o.put("equalsValue", n.longValue());
    } else if (v != null) {
      o.put("equalsValue", v.toString());
    }
    o.put("to", c.to());
    return o;
  }

  /** 조건을 읽는다(정수는 Long, 소수는 Double). */
  private static WorkflowModel.Condition readCondition(JsonNode o) {
    Object v = null;
    JsonNode e = o.get("equalsValue");
    if (e != null && !e.isNull()) {
      if (e.isBoolean()) {
        v = e.asBoolean();
      } else if (e.isIntegralNumber() && e.canConvertToLong()) {
        v = e.asLong();
      } else if (e.isNumber()) {
        v = e.asDouble();
      } else {
        v = e.asString();
      }
    }
    return new WorkflowModel.Condition(
        text(o, "assigneeRole"), text(o, "contextKey"), v, text(o, "to"));
  }

  /** 있을 때만 글 필드를 쓴다. */
  private static void putIfPresent(ObjectNode o, String field, String value) {
    if (value != null) {
      o.put(field, value);
    }
  }

  /** 글 필드를 읽는다(없거나 null 이면 null). */
  private static String text(JsonNode o, String field) {
    JsonNode v = o.get(field);
    return v == null || v.isNull() ? null : v.asString();
  }

  /** 글 배열을 목록으로 읽는다. */
  private static List<String> strings(JsonNode arr) {
    List<String> out = new ArrayList<>();
    for (JsonNode n : arr) {
      out.add(n.asString());
    }
    return out;
  }
}
