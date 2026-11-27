package com.workplace.issue.workflow;

import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.global.json.JsonMappers;
import com.workplace.issue.workflow.domain.WorkflowModel;
import com.workplace.issue.workflow.domain.WorkflowModelJson;
import com.workplace.issue.workflow.domain.WorkflowYamlParser;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.JsonNode;

/** 저장용 model JSON 이 순서·기간 표기를 지키고 왕복해도 같은지 확인한다(WP-1984). */
class WorkflowModelJsonTest {

  @Test
  @DisplayName("nodes·outcomes 는 key 가 든 배열, 기간은 ISO, 읽은 뒤에도 값·순서가 같다")
  void roundTrip_keepsOrder() throws IOException {
    String yaml =
        Files.readString(
            Path.of("src/test/resources/workflow/spec-example.yaml"), StandardCharsets.UTF_8);
    WorkflowModel model = WorkflowYamlParser.parse(yaml).model();
    assertThat(model).isNotNull();

    String json = WorkflowModelJson.write(model);
    JsonNode tree = JsonMappers.JACKSON2.readTree(json);

    assertThat(tree.get("nodes").isArray()).isTrue();
    assertThat(tree.get("nodes").get(0).get("key").asString()).isEqualTo("start");
    JsonNode dev = null;
    for (JsonNode n : tree.get("nodes")) {
      if ("dev".equals(n.get("key").asString())) {
        dev = n;
      }
    }
    assertThat(dev).isNotNull();
    assertThat(dev.get("outcomes").isArray()).isTrue();
    assertThat(dev.get("outcomes").get(1).get("key").asString()).isEqualTo("ask");
    assertThat(json).contains("\"after\":\"PT48H\"");

    WorkflowModel back = WorkflowModelJson.read(json);

    assertThat(back).isEqualTo(model);
    assertThat(new ArrayList<>(back.nodes().keySet()))
        .isEqualTo(new ArrayList<>(model.nodes().keySet()));
    List<String> outcomeKeys = new ArrayList<>(back.nodes().get("dev").outcomes().keySet());
    assertThat(outcomeKeys).containsExactly("submitted", "ask");
    assertThat(WorkflowModelJson.write(back)).isEqualTo(json);
  }

  @Test
  @DisplayName("결과·출력 name 은 있을 때만 칸이 생기고 왕복하며, 칸 없는 옛 JSON 은 null 로 읽는다")
  void outcomeAndOutputName_roundTrips() throws IOException {
    var outputs = new java.util.LinkedHashMap<String, WorkflowModel.OutputSpec>();
    outputs.put("tag", new WorkflowModel.OutputSpec("string", false, "태그"));
    outputs.put("raw", new WorkflowModel.OutputSpec("string", true, null));
    var outcomes = new java.util.LinkedHashMap<String, WorkflowModel.Outcome>();
    outcomes.put("approve", new WorkflowModel.Outcome("approve", "end", null, false, "승인"));
    outcomes.put("drop", new WorkflowModel.Outcome("drop", "end", null, false, null));
    var node =
        new WorkflowModel.Node(
            "dev",
            "agent_task",
            "개발",
            null,
            null,
            null,
            null,
            outputs,
            outcomes,
            null,
            null,
            null,
            null,
            null,
            null);
    var nodes = new java.util.LinkedHashMap<String, WorkflowModel.Node>();
    nodes.put("dev", node);
    WorkflowModel m = new WorkflowModel("genia/workflow@1", "n", null, null, nodes, null, null);

    String json = WorkflowModelJson.write(m);
    JsonNode dev = JsonMappers.JACKSON2.readTree(json).get("nodes").get(0);

    assertThat(dev.get("outcomes").get(0).get("name").asString()).isEqualTo("승인");
    assertThat(dev.get("outcomes").get(1).has("name")).isFalse();
    assertThat(dev.get("outputs").get(0).get("name").asString()).isEqualTo("태그");
    assertThat(dev.get("outputs").get(1).has("name")).isFalse();
    assertThat(WorkflowModelJson.read(json)).isEqualTo(m);

    // 옛 JSON(name 칸 없음)도 예외 없이 name null 로 읽는다.
    WorkflowModel legacy =
        WorkflowModelJson.read(
            WorkflowModelJson.write(m)
                .replace(",\"name\":\"승인\"", "")
                .replace(",\"name\":\"태그\"", ""));
    assertThat(legacy.nodes().get("dev").outcomes().get("approve").name()).isNull();
    assertThat(legacy.nodes().get("dev").outputs().get("tag").name()).isNull();
  }

  @Test
  @DisplayName("조건의 equals 값은 글·수·불리언을 구분해 왕복한다")
  void conditionEqualsValue_roundTrips() {
    var conds =
        List.of(
            new WorkflowModel.Condition(null, "a.b", "5", "x"),
            new WorkflowModel.Condition(null, "a.b", 5L, "x"),
            new WorkflowModel.Condition(null, "a.b", 1.5, "x"),
            new WorkflowModel.Condition(null, "a.b", true, "x"),
            new WorkflowModel.Condition("lead", null, null, "x"));
    WorkflowModel m =
        new WorkflowModel(
            "genia/workflow@1", "n", null, null, new java.util.LinkedHashMap<>(), conds, null);

    WorkflowModel back = WorkflowModelJson.read(WorkflowModelJson.write(m));

    assertThat(back.start()).isEqualTo(conds);
    assertThat(back.roles()).isEmpty();
    assertThat(back.layout()).isEmpty();
  }

  /** 같은 해시를 내는 블록(a,b)을 이어 만든 충돌 이름 count 개. */
  private static List<String> collidingKeys(String a, String b, int count) {
    List<String> keys = new ArrayList<>();
    for (int i = 0; i < count; i++) {
      StringBuilder sb = new StringBuilder();
      for (int bit = 0; bit < 10; bit++) {
        sb.append(((i >> bit) & 1) == 0 ? a : b);
      }
      keys.add(sb.toString());
    }
    return keys;
  }

  /** 접두 문서(머리말) 뒤에 노드·start 꼬리를 붙인 최소 정의. */
  private static String doc(String roles, String shared, String nodeExtra, String layout) {
    return "schema: genia/workflow@1\nname: t\n"
        + shared
        + "roles:\n"
        + roles
        + "nodes:\n  start: { type: start }\n  end: { type: end }\n"
        + nodeExtra
        + "start:\n  - { when: { assigneeRole: owner }, to: end }\n"
        + layout;
  }

  @Test
  @DisplayName("충돌하는 사용자 이름 600개(shared·roles·outputs·layout)도 parse → write → read 가 같다")
  void collidingNames_roundTrip() {
    List<String> upper = collidingKeys("Ab", "BA", 600);
    List<String> lower = collidingKeys("ar", "c0", 600);
    StringBuilder shared = new StringBuilder("shared:\n");
    upper.forEach(k -> shared.append("  ").append(k).append(": t\n"));
    StringBuilder roles = new StringBuilder("  owner: { members: [] }\n");
    lower.forEach(k -> roles.append("  ").append(k).append(": { members: [] }\n"));
    StringBuilder outputs =
        new StringBuilder("  w:\n    type: agent_task\n    role: owner\n    outputs:\n");
    lower.forEach(k -> outputs.append("      ").append(k).append(": { type: string }\n"));
    StringBuilder layout = new StringBuilder("layout:\n");
    upper.forEach(k -> layout.append("  ").append(k).append(": { x: 1, y: 2 }\n"));

    String[] docs = {
      doc("  owner: { members: [] }\n", shared.toString(), "", ""),
      doc(roles.toString(), "", "", ""),
      doc("  owner: { members: [] }\n", "", outputs.toString(), ""),
      doc("  owner: { members: [] }\n", "", "", layout.toString())
    };
    String[] names = {"shared", "roles", "outputs", "layout"};
    for (int i = 0; i < docs.length; i++) {
      var parsed = WorkflowYamlParser.parse(docs[i]);
      assertThat(parsed.problems()).as(names[i]).isEmpty();
      WorkflowModel model = parsed.model();
      String json = WorkflowModelJson.write(model);
      WorkflowModel back = WorkflowModelJson.read(json);
      assertThat(back).as(names[i]).isEqualTo(model);
      assertThat(new ArrayList<>(back.shared().keySet()))
          .isEqualTo(new ArrayList<>(model.shared().keySet()));
      assertThat(new ArrayList<>(back.roles().keySet()))
          .isEqualTo(new ArrayList<>(model.roles().keySet()));
      assertThat(new ArrayList<>(back.layout().keySet()))
          .isEqualTo(new ArrayList<>(model.layout().keySet()));
    }
  }

  @Test
  @DisplayName("사용자가 정한 글은 JSON 필드 이름이 아니라 key 가 든 배열로 쓴다(roles·shared·layout·outputs)")
  void userNames_areKeyedArrays() {
    String yaml =
        "schema: genia/workflow@1\nname: t\nshared:\n  s1: 가\nroles:\n  owner: { members: [a@x.com] }\n"
            + "nodes:\n  start: { type: start }\n  w:\n    type: agent_task\n    role: owner\n"
            + "    outputs:\n      o1: { type: string, required: true }\n  end: { type: end }\n"
            + "start:\n  - { when: { assigneeRole: owner }, to: end }\n"
            + "layout:\n  w: { x: 1, y: 2 }\n";
    WorkflowModel model = WorkflowYamlParser.parse(yaml).model();
    assertThat(model).isNotNull();

    JsonNode tree = JsonMappers.JACKSON2.readTree(WorkflowModelJson.write(model));

    assertThat(tree.get("roles").isArray()).isTrue();
    assertThat(tree.get("roles").get(0).get("key").asString()).isEqualTo("owner");
    assertThat(tree.get("roles").get(0).get("memberUsernames").isArray()).isTrue();
    assertThat(tree.get("shared").isArray()).isTrue();
    assertThat(tree.get("shared").get(0).get("key").asString()).isEqualTo("s1");
    assertThat(tree.get("shared").get(0).get("text").asString()).isEqualTo("가");
    assertThat(tree.get("layout").isArray()).isTrue();
    assertThat(tree.get("layout").get(0).get("key").asString()).isEqualTo("w");
    assertThat(tree.get("layout").get(0).get("x").asDouble()).isEqualTo(1.0);
    JsonNode w = null;
    for (JsonNode n : tree.get("nodes")) {
      if ("w".equals(n.get("key").asString())) {
        w = n;
      }
    }
    assertThat(w).isNotNull();
    assertThat(w.get("outputs").isArray()).isTrue();
    assertThat(w.get("outputs").get(0).get("key").asString()).isEqualTo("o1");
    assertThat(w.get("outputs").get(0).get("required").asBoolean()).isTrue();
  }
}
