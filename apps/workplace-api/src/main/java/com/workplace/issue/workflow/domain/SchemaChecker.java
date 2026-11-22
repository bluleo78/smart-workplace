package com.workplace.issue.workflow.domain;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.function.Supplier;
import java.util.regex.Pattern;
import org.yaml.snakeyaml.nodes.MappingNode;
import org.yaml.snakeyaml.nodes.Node;
import org.yaml.snakeyaml.nodes.NodeTuple;
import org.yaml.snakeyaml.nodes.ScalarNode;
import org.yaml.snakeyaml.nodes.SequenceNode;
import tools.jackson.databind.JsonNode;

/**
 * 스키마({@code workflow-schema.json}) 로 SnakeYAML Node 트리의 형태를 검사한다.
 *
 * <p>왜: 문법·형태 규칙의 단일 원본을 스키마 파일 하나로 두되, JSON Schema 라이브러리는 새 의존성과 Jackson 2 경계 문제가 있고 줄·열 위치를 잃는다.
 * 그래서 스키마가 실제로 쓰는 키워드({@link WorkflowSchema#SUPPORTED_KEYWORDS})만 해석하는 작은 검사기를 두고 Node 트리를 직접 걷는다.
 * 문자열 칸은 따옴표 없는 yes·2026 같은 값도 적힌 글로 받아들인다({@link YamlScalars}). 첫 오류에서 멈추지 않고 모두 모은다.
 */
final class SchemaChecker {

  /** 문제 알림 창구(실제 기록 또는 oneOf 시험용 집계). */
  interface Reporter {
    /** detail 은 같은 자리의 서로 다른 오류를 가르는 짧은 구분값(없으면 null). */
    void report(String code, Supplier<String> message, List<String> path, String detail);

    /** 구분값 없는 알림. */
    default void report(String code, Supplier<String> message, List<String> path) {
      report(code, message, path, null);
    }
  }

  /** 스키마 노드 키 패턴(메시지를 쉬운 말로 바꾸기 위해 알아본다). */
  private static final String KEY_PATTERN = "^[a-z][a-z0-9_]*$";

  /**
   * 스키마의 pattern 을 생성 때 모두 컴파일해 둔 읽기 전용 표. 요청 스레드가 공유하는 검사기에서 가변 맵을 쓰면 첫 요청들이 동시에 채우다 깨지므로(WP-1984
   * 검토 I2) 생성자 한 번에 끝내고 이후 읽기만 한다.
   */
  private final Map<String, Pattern> patterns;

  private final JsonNode root;

  SchemaChecker(JsonNode schemaRoot) {
    this.root = schemaRoot;
    Map<String, Pattern> found = new HashMap<>();
    collectPatterns(schemaRoot, found);
    this.patterns = Map.copyOf(found);
  }

  /** 스키마 어디에 있든 pattern 값을 모아 컴파일한다(properties 의 필드 이름이 pattern 이어도 값이 글일 때만). */
  private static void collectPatterns(JsonNode node, Map<String, Pattern> out) {
    if (node.isObject()) {
      for (var e : node.properties()) {
        if (e.getKey().equals("pattern") && e.getValue().isString()) {
          out.computeIfAbsent(e.getValue().asString(), Pattern::compile);
        } else {
          collectPatterns(e.getValue(), out);
        }
      }
    } else if (node.isArray()) {
      node.forEach(n -> collectPatterns(n, out));
    }
  }

  /** 노드를 스키마에 견줘 검사한다. */
  void check(Node node, JsonNode schema, List<String> path, Reporter out) {
    JsonNode s = resolve(schema);
    JsonNode type = s.get("type");
    if (type != null
        && node instanceof ScalarNode big
        && YamlScalars.kind(big) == YamlScalars.Kind.BIGINT
        && wantsNumber(type)) {
      // 수 칸에 long 범위를 넘는 정수 — 반올림해 다른 값이 되지 않도록 거절한다.
      out.report("SCHEMA_VALUE", () -> display(path) + ": 정수가 너무 큽니다.", path);
      return;
    }
    if (type != null && !typeMatches(node, type)) {
      out.report(
          "SCHEMA_TYPE", () -> display(path) + ": " + describeType(type) + " 이어야 합니다.", path);
      return;
    }
    if (node instanceof ScalarNode scalar) {
      String violation = textViolation(scalar.getValue(), YamlScalars.kind(scalar), scalar, s);
      if (violation != null) {
        out.report("SCHEMA_VALUE", () -> display(path) + ": " + violation, path);
      }
    } else if (hasTextRule(s)) {
      out.report("SCHEMA_VALUE", () -> display(path) + ": 값이 올바르지 않습니다.", path);
    }
    if (node instanceof MappingNode map) {
      checkObject(map, s, path, out);
    } else if (node instanceof SequenceNode seq && s.has("items")) {
      int i = 0;
      for (Node item : seq.getValue()) {
        List<String> p = append(path, Integer.toString(i++));
        check(item, s.get("items"), p, out);
      }
    }
    JsonNode oneOf = s.get("oneOf");
    if (oneOf != null) {
      int matches = 0;
      for (JsonNode branch : oneOf) {
        int[] count = new int[1];
        check(node, branch, path, (c, m, p, d) -> count[0]++);
        if (count[0] == 0) {
          matches++;
        }
      }
      if (matches != 1) {
        JsonNode d = s.get("description");
        out.report(
            "SCHEMA_VALUE",
            () -> display(path) + ": 올바른 형태가 아닙니다" + (d == null ? "." : " — " + d.asString()),
            path);
      }
    }
  }

  /** 맵 노드의 properties·required·additionalProperties·propertyNames 를 검사한다. */
  private void checkObject(MappingNode map, JsonNode s, List<String> path, Reporter out) {
    JsonNode props = s.get("properties");
    JsonNode additional = s.get("additionalProperties");
    JsonNode names = s.get("propertyNames");
    Set<String> present = new HashSet<>();
    for (NodeTuple tuple : map.getValue()) {
      if (!(tuple.getKeyNode() instanceof ScalarNode keyNode)) {
        out.report("SCHEMA_TYPE", () -> display(path) + ": 키는 글이어야 합니다.", path);
        continue;
      }
      String key = keyNode.getValue();
      present.add(key);
      List<String> keyPath = append(path, key);
      if (YamlScalars.kind(keyNode) == YamlScalars.Kind.NULL) {
        // null·~·빈 키는 적힌 글이 아니라 값 없음이다 — 식별자로 쓸 수 없다.
        out.report("SCHEMA_VALUE", () -> display(path) + ": 키를 비워 둘 수 없습니다.", keyPath);
        continue;
      }
      if (names != null) {
        String violation = textViolation(key, YamlScalars.Kind.STRING, null, resolve(names));
        if (violation != null) {
          out.report(
              "SCHEMA_VALUE", () -> "키 '" + ParseSession.clip(key) + "': " + violation, keyPath);
        }
      }
      JsonNode known = props == null ? null : props.get(key);
      if (known != null) {
        check(tuple.getValueNode(), known, keyPath, out);
      } else if (additional != null && additional.isBoolean() && !additional.asBoolean()) {
        out.report(
            "SCHEMA_FIELD_UNKNOWN",
            () -> "알 수 없는 필드 '" + ParseSession.clip(key) + "' 입니다. 철자를 확인해 주세요.",
            keyPath);
      } else if (additional != null && additional.isObject()) {
        check(tuple.getValueNode(), additional, keyPath, out);
      }
    }
    JsonNode required = s.get("required");
    if (required != null) {
      for (JsonNode r : required) {
        if (!present.contains(r.asString())) {
          out.report(
              "SCHEMA_REQUIRED",
              () -> display(path) + ": 필수 필드 '" + r.asString() + "' 가 없습니다.",
              path,
              r.asString());
        }
      }
    }
  }

  /** const·enum·pattern·minimum·not 중 하나라도 있는지(맵·목록에 글 규칙이 붙은 오류 판정용). */
  private static boolean hasTextRule(JsonNode s) {
    return s.has("const")
        || s.has("enum")
        || s.has("pattern")
        || s.has("minimum")
        || s.has("minLength")
        || s.has("maxLength")
        || s.has("not");
  }

  /** 글 규칙 위반 설명(없으면 null). scalar 는 수 비교용이며 키 검사에서는 null. */
  private String textViolation(String text, YamlScalars.Kind kind, ScalarNode scalar, JsonNode s) {
    JsonNode c = s.get("const");
    if (c != null && !c.asString().equals(text)) {
      return "'" + c.asString() + "' 이어야 합니다.";
    }
    JsonNode e = s.get("enum");
    if (e != null) {
      List<String> allowed = new ArrayList<>();
      boolean ok = false;
      for (JsonNode v : e) {
        allowed.add(v.asString());
        ok |= v.asString().equals(text);
      }
      if (!ok) {
        return "다음 중 하나여야 합니다: " + String.join(", ", allowed) + ".";
      }
    }
    JsonNode p = s.get("pattern");
    // 스키마의 패턴은 모두 ^…$ 로 감싼 꼴이라 전체 일치(matches)로 본다. find 는 끝의 줄 바꿈 앞에서 $ 가 맞아 "dev\n" 을 통과시킨다.
    if (p != null && !patterns.get(p.asString()).matcher(text).matches()) {
      return p.asString().equals(KEY_PATTERN)
          ? "소문자로 시작하고 소문자·숫자·밑줄(_)만 쓸 수 있습니다."
          : "형식이 올바르지 않습니다.";
    }
    JsonNode minLen = s.get("minLength");
    JsonNode maxLen = s.get("maxLength");
    if (minLen != null || maxLen != null) {
      int len = text.codePointCount(0, text.length());
      if (minLen != null && len < minLen.asInt()) {
        return minLen.asInt() + "자 이상이어야 합니다.";
      }
      if (maxLen != null && len > maxLen.asInt()) {
        return maxLen.asInt() + "자 이하여야 합니다.";
      }
    }
    JsonNode min = s.get("minimum");
    if (min != null
        && scalar != null
        && (kind == YamlScalars.Kind.INT || kind == YamlScalars.Kind.FLOAT)
        && YamlScalars.number(scalar) < min.asDouble()) {
      return min.asString() + " 이상이어야 합니다.";
    }
    JsonNode not = s.get("not");
    if (not != null && textViolation(text, kind, scalar, resolve(not)) == null) {
      JsonNode nc = resolve(not).get("const");
      return nc == null ? "쓸 수 없는 값입니다." : "'" + nc.asString() + "' 은(는) 쓸 수 없는 값입니다(예약어).";
    }
    return null;
  }

  /** 노드가 type(문자열 또는 문자열 배열) 중 하나에 맞는지. 글은 따옴표 없는 yes·2026 도 받는다(null 만 거절). */
  private static boolean typeMatches(Node node, JsonNode type) {
    if (type.isArray()) {
      for (JsonNode t : type) {
        if (typeMatches(node, t)) {
          return true;
        }
      }
      return false;
    }
    String t = type.asString();
    if (node instanceof MappingNode) {
      return t.equals("object");
    }
    if (node instanceof SequenceNode) {
      return t.equals("array");
    }
    if (!(node instanceof ScalarNode scalar)) {
      return false;
    }
    YamlScalars.Kind kind = YamlScalars.kind(scalar);
    return switch (t) {
      case "string" -> kind != YamlScalars.Kind.NULL;
      case "integer" -> kind == YamlScalars.Kind.INT;
      case "number" -> kind == YamlScalars.Kind.INT || kind == YamlScalars.Kind.FLOAT;
      case "boolean" -> kind == YamlScalars.Kind.BOOL;
      default -> false;
    };
  }

  /** type(문자열 또는 배열)이 정수나 수를 허용하는지. */
  private static boolean wantsNumber(JsonNode type) {
    if (type.isArray()) {
      for (JsonNode t : type) {
        if (wantsNumber(t)) {
          return true;
        }
      }
      return false;
    }
    return type.asString().equals("integer") || type.asString().equals("number");
  }

  /** type 을 쉬운 말로. */
  private static String describeType(JsonNode type) {
    if (type.isArray()) {
      List<String> parts = new ArrayList<>();
      type.forEach(t -> parts.add(describeType(t)));
      return String.join(" 또는 ", parts);
    }
    return switch (type.asString()) {
      case "object" -> "맵(키: 값)";
      case "array" -> "목록";
      case "string" -> "글";
      case "integer" -> "정수";
      case "number" -> "수";
      case "boolean" -> "true 또는 false";
      default -> type.asString();
    };
  }

  /** $ref(#/$defs/이름)를 따라간다. 가리키는 곳이 없으면 스키마 결함이라 즉시 실패한다. */
  private JsonNode resolve(JsonNode schema) {
    JsonNode ref = schema.get("$ref");
    if (ref == null) {
      return schema;
    }
    JsonNode target = root.at(ref.asString().substring(1));
    if (target.isMissingNode()) {
      throw new IllegalStateException("스키마 $ref 를 찾지 못했다: " + ref.asString());
    }
    return resolve(target);
  }

  /** 경로를 사람이 읽는 꼴로. 빈 경로는 문서 맨 위. */
  private static String display(List<String> path) {
    if (path.isEmpty()) {
      return "문서 최상위";
    }
    List<String> clipped = new ArrayList<>(path.size());
    path.forEach(seg -> clipped.add(ParseSession.clip(seg)));
    return String.join(".", clipped);
  }

  /** 경로에 한 단계 붙인 새 목록. */
  private static List<String> append(List<String> path, String segment) {
    List<String> out = new ArrayList<>(path.size() + 1);
    out.addAll(path);
    out.add(segment);
    return out;
  }
}
