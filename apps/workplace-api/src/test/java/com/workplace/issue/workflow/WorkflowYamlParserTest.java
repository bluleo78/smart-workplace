package com.workplace.issue.workflow;

import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.issue.workflow.domain.ParseResult;
import com.workplace.issue.workflow.domain.SourceMap;
import com.workplace.issue.workflow.domain.WorkflowModel;
import com.workplace.issue.workflow.domain.WorkflowModelJson;
import com.workplace.issue.workflow.domain.WorkflowYamlParser;
import com.workplace.issue.workflow.dto.WorkflowProblem;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/** 워크플로우 YAML 파서의 문법·형태·펼침·위치 규칙을 DB 없이 확인한다(WP-1984). */
class WorkflowYamlParserTest {

  /** 모든 시나리오가 공유하는 가장 작은 유효 정의 머리말(roles 까지). */
  private static final String HEAD =
      """
      schema: genia/workflow@1
      name: t
      roles:
        owner: { members: [owner@example.com] }
        developer: { members: [dev@example.com] }
      """;

  /** 시작·끝 노드와 start 목록 꼬리(nodes 를 이어 쓴다). */
  private static final String START_END =
      """
        start: { type: start }
        end: { type: end }
      """;

  private static final String TAIL =
      """
      start:
        - { when: { assigneeRole: owner }, to: end }
      """;

  private static ParseResult parse(String yaml) {
    return WorkflowYamlParser.parse(yaml);
  }

  private static List<String> codes(ParseResult r) {
    return r.problems().stream().map(WorkflowProblem::code).toList();
  }

  private static String spec() throws IOException {
    Path file = Path.of("src/test/resources/workflow/spec-example.yaml");
    return Files.readString(file, StandardCharsets.UTF_8);
  }

  private static int lineOf(String yaml, String marker) {
    String[] lines = yaml.split("\r?\n", -1);
    for (int i = 0; i < lines.length; i++) {
      if (lines[i].contains(marker)) {
        return i + 1;
      }
    }
    throw new AssertionError("표시를 찾지 못했다: " + marker);
  }

  @Test
  @DisplayName("상위 설계 예시를 그대로 읽는다: 오류 없음, 노드 9개, start 3개, 적힌 순서")
  void parsesSpecExample() throws IOException {
    ParseResult r = parse(spec());

    assertThat(r.problems()).isEmpty();
    WorkflowModel m = r.model();
    assertThat(m.schema()).isEqualTo("genia/workflow@1");
    assertThat(m.nodes()).hasSize(9);
    assertThat(m.start()).hasSize(3);
    assertThat(m.nodes().get("plan").outputs().get("planDoc").required()).isTrue();
    assertThat(m.nodes().get("plan").outputs().get("planDoc").type()).isEqualTo("url");
    assertThat(m.nodes().keySet())
        .containsExactly(
            "start", "triage", "plan", "plan_ok", "dev", "dev_ask", "review", "confirm", "done");
    assertThat(m.nodes().get("plan_ok").timeout().after()).isEqualTo(Duration.ofHours(48));
    assertThat(m.nodes().get("review").maxVisits()).isEqualTo(3);
    assertThat(m.nodes().get("dev").onError().to()).isEqualTo("triage");
    assertThat(m.layout().get("triage").x()).isEqualTo(200.0);
    assertThat(m.roles().get("developer").memberUsernames())
        .containsExactly("dev1@example.com", "dev2@example.com");
  }

  @Test
  @DisplayName("ask 줄임은 질문 답변 사람 노드로 펼쳐지고 위치는 ask 줄이다")
  void askShorthand_expandsToHumanNode() {
    String yaml =
        HEAD
            + "nodes:\n"
            + START_END
            + "  dev:\n"
            + "    type: agent_task\n"
            + "    name: 개발\n"
            + "    role: developer\n"
            + "    ask: { role: owner }\n"
            + "    outcomes:\n"
            + "      submitted: { to: end }\n"
            + "  later: { type: end }\n"
            + TAIL;

    ParseResult r = parse(yaml);

    assertThat(r.problems()).isEmpty();
    WorkflowModel m = r.model();
    assertThat(m.nodes().keySet()).containsExactly("start", "end", "dev", "dev_ask", "later");
    WorkflowModel.Node ask = m.nodes().get("dev_ask");
    assertThat(ask.type()).isEqualTo("human_task");
    assertThat(ask.roleKey()).isEqualTo("owner");
    assertThat(ask.name()).isEqualTo("개발 질문 답변");
    assertThat(ask.returnTo()).isEqualTo("dev");
    assertThat(ask.timeout().after()).isEqualTo(Duration.ofHours(24));
    assertThat(ask.timeout().then()).isEqualTo("remind");
    assertThat(ask.outcomes().get("answered"))
        .isEqualTo(new WorkflowModel.Outcome("answered", "dev", "keep", true));
    assertThat(m.nodes().get("dev").outcomes().get("ask"))
        .isEqualTo(new WorkflowModel.Outcome("ask", "dev_ask", "owner", true));
    assertThat(m.nodes().get("dev").outcomes().keySet()).containsExactly("submitted", "ask");

    int askLine = lineOf(yaml, "ask: { role: owner }");
    assertThat(r.source().at("nodes.dev_ask").line()).isEqualTo(askLine);
    assertThat(r.source().at("nodes.dev_ask.outcomes.answered.to").line()).isEqualTo(askLine);
    assertThat(r.source().at("nodes.dev.outcomes.ask.to").line()).isEqualTo(askLine);
    assertThat(r.source().has("nodes.dev_ask.returnTo")).isTrue();
  }

  @Test
  @DisplayName("ask 줄임은 같은 키 노드나 ask 결과가 이미 있으면 ASK_CONFLICT")
  void askShorthand_conflict() {
    String byNode =
        HEAD
            + "nodes:\n"
            + START_END
            + "  dev_ask: { type: human_task, role: owner }\n"
            + "  dev: { type: agent_task, role: developer, ask: { role: owner } }\n"
            + TAIL;
    String byOutcome =
        HEAD
            + "nodes:\n"
            + START_END
            + "  dev:\n"
            + "    type: agent_task\n"
            + "    role: developer\n"
            + "    ask: { role: owner }\n"
            + "    outcomes:\n"
            + "      ask: { to: end }\n"
            + TAIL;

    ParseResult a = parse(byNode);
    ParseResult b = parse(byOutcome);

    assertThat(codes(a)).containsExactly("ASK_CONFLICT");
    assertThat(a.model()).isNull();
    assertThat(a.problems().get(0).nodeKey()).isEqualTo("dev");
    assertThat(a.problems().get(0).line()).isEqualTo(lineOf(byNode, "ask: { role: owner }"));
    assertThat(codes(b)).containsExactly("ASK_CONFLICT");
    assertThat(b.model()).isNull();
  }

  @Test
  @DisplayName("ask 는 agent_task 에서만 펼친다 — 다른 종류는 펼치지 않고 위치표에 남긴다")
  void askShorthand_ignoredForOtherTypes() {
    String yaml =
        HEAD
            + "nodes:\n"
            + START_END
            + "  w: { type: human_task, role: owner, ask: { role: owner } }\n"
            + TAIL;

    ParseResult r = parse(yaml);

    assertThat(r.problems()).isEmpty();
    assertThat(r.model().nodes().keySet()).containsExactly("start", "end", "w");
    assertThat(r.source().has("nodes.w.ask")).isTrue();
  }

  @Test
  @DisplayName("use 는 적힌 순서의 shared 와 노드 지시를 빈 줄로 잇고 없는 이름은 건너뛴다")
  void sharedUse_prependsInstructions() {
    String yaml =
        HEAD.replace("roles:", "shared:\n  a: A\n  b: B\nroles:")
            + "nodes:\n"
            + START_END
            + "  dev:\n"
            + "    type: agent_task\n"
            + "    role: developer\n"
            + "    use: [a, missing, b]\n"
            + "    instructions: 본문\n"
            + "  only:\n"
            + "    type: agent_task\n"
            + "    role: developer\n"
            + "    use: [b]\n"
            + TAIL;

    ParseResult r = parse(yaml);

    assertThat(r.problems()).isEmpty();
    assertThat(r.model().nodes().get("dev").instructions()).isEqualTo("A\n\nB\n\n본문");
    assertThat(r.model().nodes().get("dev").use()).containsExactly("a", "missing", "b");
    assertThat(r.model().nodes().get("only").instructions()).isEqualTo("B");
  }

  @Test
  @DisplayName("문법 오류는 정확한 줄·열(1부터)을 준다")
  void syntaxError_hasLineAndColumn() {
    ParseResult r = parse("a: 1\nb: [\n");

    assertThat(codes(r)).containsExactly("YAML_SYNTAX");
    assertThat(r.model()).isNull();
    assertThat(r.problems().get(0).severity()).isEqualTo("ERROR");
    assertThat(r.problems().get(0).line()).isEqualTo(3);
    assertThat(r.problems().get(0).column()).isEqualTo(1);
  }

  @Test
  @DisplayName("형태 오류(모르는 필드·타입)는 한 번에 모아 내고 model 은 null")
  void shapeErrors_collectedTogether() {
    String yaml =
        HEAD
            + "nodes:\n"
            + START_END
            + "  dev:\n"
            + "    type: agent_task\n"
            + "    role: developer\n"
            + "    bogus: 1\n"
            + "    maxVisits: abc\n"
            + TAIL;

    ParseResult r = parse(yaml);

    assertThat(codes(r)).containsExactlyInAnyOrder("SCHEMA_FIELD_UNKNOWN", "SCHEMA_TYPE");
    assertThat(r.problems()).hasSize(2);
    assertThat(r.model()).isNull();
    WorkflowProblem unknown =
        r.problems().stream()
            .filter(p -> p.code().equals("SCHEMA_FIELD_UNKNOWN"))
            .findFirst()
            .get();
    assertThat(unknown.line()).isEqualTo(lineOf(yaml, "bogus: 1"));
    assertThat(unknown.column()).isEqualTo(5);
    assertThat(unknown.nodeKey()).isEqualTo("dev");
  }

  @Test
  @DisplayName("필수 필드 누락·패턴·값 오류도 코드로 나온다")
  void requiredAndValueErrors() {
    String yaml =
        "schema: genia/workflow@2\n"
            + "roles:\n"
            + "  keep: { members: [] }\n"
            + "  Bad-Key: { members: [a] }\n"
            + "nodes:\n"
            + "  x:\n"
            + "    name: n\n"
            + "    outcomes:\n"
            + "      go: { assignTo: owner }\n"
            + "    maxVisits: 0\n"
            + "    timeout: { after: P1D, then: nag }\n"
            + "start:\n"
            + "  - { when: { assigneeRole: a, context: k, equals: v }, to: x }\n";

    ParseResult r = parse(yaml);

    assertThat(r.model()).isNull();
    assertThat(codes(r)).contains("SCHEMA_REQUIRED", "SCHEMA_VALUE");
    // schema 값, name 누락, keep, Bad-Key, type 누락, to 누락, maxVisits, then, when 형태
    assertThat(r.problems()).hasSize(9);
  }

  /** 비정상 문서 한 건: 기대 코드와 정확한 줄·열. */
  private record Abnormal(String code, String yaml, int line, int column) {}

  @Test
  @DisplayName("비정상 문서는 500 이 아니라 각자의 코드와 정확한 줄·열의 문제가 된다")
  void abnormalDocuments_areProblems() {
    String tail = "nodes: {}\nstart: []\n";
    List<Abnormal> cases =
        List.of(
            new Abnormal("YAML_EMPTY", "", 1, 1),
            new Abnormal("YAML_EMPTY", "# 주석만\n", 1, 1),
            new Abnormal("YAML_EMPTY", "---\n", 1, 1),
            new Abnormal("SCHEMA_TYPE", "just text\n", 1, 1),
            new Abnormal("YAML_DUPLICATE_KEY", HEAD + "name: again\n" + tail, 6, 1),
            new Abnormal("YAML_ALIAS", HEAD.replace("name: t", "name: &n t") + tail, 2, 7),
            new Abnormal("YAML_ALIAS", "a: 1\nb: 2\nc: &x [1]\nd: *x\n", 3, 4),
            new Abnormal("YAML_ALIAS", "a: &x 1\nb: *x\n", 1, 4),
            new Abnormal("YAML_CUSTOM_TAG", HEAD.replace("name: t", "name: !foo t") + tail, 2, 7),
            new Abnormal("YAML_MULTIPLE_DOCUMENTS", HEAD + tail + "---\nb: 1\n", 8, 1),
            new Abnormal("YAML_TOO_DEEP", "[".repeat(51) + "]".repeat(51), 1, 51),
            new Abnormal("YAML_TOO_LARGE", "a".repeat(262_145), 1, 1));

    for (Abnormal c : cases) {
      ParseResult r = parse(c.yaml());
      String label = c.code() + " @" + c.line() + ":" + c.column();
      assertThat(r.model()).as(label).isNull();
      assertThat(r.problems()).as(label).isNotEmpty();
      WorkflowProblem first =
          r.problems().stream().filter(p -> p.code().equals(c.code())).findFirst().orElse(null);
      assertThat(first).as(label).isNotNull();
      assertThat(first.line()).as(label).isEqualTo(c.line());
      assertThat(first.column()).as(label).isEqualTo(c.column());
    }
  }

  @Test
  @DisplayName("깊이 위반은 이벤트가 닿은 정확한 위치 — 블록 60단계, 흐름 57단계")
  void tooDeep_reportsExactPosition() {
    StringBuilder block = new StringBuilder("a: 1\nb: 2\n");
    for (int i = 0; i < 60; i++) {
      block.append("  ".repeat(i)).append("k:\n");
    }
    block.append("  ".repeat(60)).append("x\n");
    ParseResult b = parse(block.toString());
    WorkflowProblem bp =
        b.problems().stream().filter(p -> p.code().equals("YAML_TOO_DEEP")).findFirst().get();
    // 루트(1단계)의 k 값이 2단계 — 51단계 맵은 53번째 줄, 열은 들여쓰기 100칸 뒤
    assertThat(bp.line()).isEqualTo(53);
    assertThat(bp.column()).isEqualTo(101);

    ParseResult f = parse("x: 1\ny: 2\nz: " + "[".repeat(57) + "]".repeat(57) + "\n");
    WorkflowProblem fp =
        f.problems().stream().filter(p -> p.code().equals("YAML_TOO_DEEP")).findFirst().get();
    // 루트 맵이 1단계, 50번째 [ 가 51단계
    assertThat(fp.line()).isEqualTo(3);
    assertThat(fp.column()).isEqualTo(4 + 49);
  }

  @Test
  @DisplayName("표준 태그·! 한 글자·%TAG 지시문도 첫 태그의 정확한 위치에서 거절한다")
  void explicitTags_rejectedAtFirstTag() {
    String tail = "nodes: {}\nstart: []\n";
    String[] tagged = {"!!str t", "!foo t", "! t"};
    for (String value : tagged) {
      ParseResult r = parse(HEAD.replace("name: t", "name: " + value) + tail);
      assertThat(codes(r)).as(value).containsExactly("YAML_CUSTOM_TAG");
      assertThat(r.problems().get(0).line()).as(value).isEqualTo(2);
      assertThat(r.problems().get(0).column()).as(value).isEqualTo(7);
    }
    ParseResult coll = parse(HEAD.replace("roles:", "roles: !!map") + tail);
    assertThat(codes(coll)).containsExactly("YAML_CUSTOM_TAG");
    assertThat(coll.problems().get(0).column()).isEqualTo(8);

    ParseResult eq =
        parse(
            HEAD
                + "nodes:\n"
                + START_END
                + "  route:\n"
                + "    type: decision\n"
                + "    conditions:\n"
                + "      - { when: { context: a.b, equals: !!str 5 }, to: end }\n"
                + TAIL);
    assertThat(codes(eq)).containsExactly("YAML_CUSTOM_TAG");

    // %TAG 접두사로 노드마다 긴 태그를 만드는 문서는 지시문 줄에서 멈춘다(노드를 만들기 전)
    String directive =
        "%TAG !e! tag:example.com,2000:\n---\n" + HEAD.replace("name: t", "name: !e!x t") + tail;
    ParseResult d = parse(directive);
    assertThat(codes(d)).containsExactly("YAML_CUSTOM_TAG");
    assertThat(d.problems().get(0).line()).isEqualTo(1);
    assertThat(d.problems().get(0).column()).isEqualTo(1);
  }

  @Test
  @DisplayName("스칼라·컬렉션 별칭은 첫 앵커 위치에서 멈추고 다른 문제를 더 찾지 않는다")
  void aliases_stopAtFirstAnchor() {
    ParseResult r =
        parse(HEAD.replace("[dev@example.com]", "[&a x, *a, *a]") + "nodes: {}\nstart: []\n");

    assertThat(r.problems()).hasSize(1);
    assertThat(r.problems().get(0).code()).isEqualTo("YAML_ALIAS");
    assertThat(r.problems().get(0).line()).isEqualTo(5);
    assertThat(r.problems().get(0).column()).isEqualTo("  developer: { members: [".length() + 1);
  }

  @Test
  @DisplayName("키 패턴은 끝의 줄 바꿈으로 우회할 수 없다(노드 키·역할 키·keep)")
  void keyPattern_rejectsTrailingLineBreak() {
    for (String bad : List.of("dev\\n", "dev\\r\\n", "dev\\L", "dev\\N", "dev\\P")) {
      String nodes = HEAD + "nodes:\n" + START_END + "  \"" + bad + "\": { type: end }\n" + TAIL;
      assertThat(codes(parse(nodes))).as("node " + bad).contains("SCHEMA_VALUE");
    }
    String role =
        HEAD.replace("roles:", "roles:\n  \"keep\\n\": { members: [] }")
            + "nodes:\n"
            + START_END
            + TAIL;
    ParseResult r = parse(role);
    assertThat(codes(r)).contains("SCHEMA_VALUE");
    assertThat(r.model()).isNull();
  }

  @Test
  @DisplayName("long 범위 정수는 정확히 Long, 범위 밖 정수는 수 칸에서 SCHEMA_VALUE, 글 칸은 그대로")
  void integers_exactOrRejected() {
    String conds =
        "      - { when: { context: a.b, equals: 9223372036854775807 }, to: end }\n"
            + "      - { when: { context: a.b, equals: 1000000000000000001 }, to: end }\n"
            + "      - { when: { context: a.b, equals: 0000000000000000001 }, to: end }\n"
            + "      - { when: { context: a.b, equals: -9223372036854775808 }, to: end }\n";
    String ok =
        HEAD
            + "nodes:\n"
            + START_END
            + "  r:\n    type: decision\n    conditions:\n"
            + conds
            + TAIL;
    ParseResult r = parse(ok);
    assertThat(r.problems()).isEmpty();
    assertThat(r.model().nodes().get("r").conditions())
        .extracting(WorkflowModel.Condition::equalsValue)
        .containsExactly(Long.MAX_VALUE, 1000000000000000001L, 1L, Long.MIN_VALUE);

    String big =
        HEAD
            + "nodes:\n"
            + START_END
            + "  r:\n    type: decision\n    conditions:\n"
            + "      - { when: { context: a.b, equals: 9223372036854775808 }, to: end }\n"
            + "  m: { type: agent_task, role: owner, maxVisits: 99999999999999999999, name: 99999999999999999999 }\n"
            + TAIL;
    ParseResult b = parse(big);
    assertThat(codes(b)).containsExactly("SCHEMA_VALUE", "SCHEMA_VALUE");
    assertThat(b.problems().get(0).line()).isEqualTo(lineOf(big, "9223372036854775808"));
  }

  @Test
  @DisplayName("null·~·빈 키와 길이 규칙(1~100자) 위반 키는 SCHEMA_VALUE")
  void keys_nullEmptyAndLength() {
    String h100 = "a".repeat(100);
    String h101 = "a".repeat(101);
    String yaml =
        HEAD
            + "nodes:\n"
            + START_END
            + "  e2:\n"
            + "    type: human_task\n"
            + "    outcomes:\n"
            + "      null: { to: end }\n"
            + "      ~: { to: end }\n"
            + "      ? \n"
            + "      : { to: end }\n"
            + "      "
            + h100
            + ": { to: end }\n"
            + "      "
            + h101
            + ": { to: end }\n"
            // 따옴표 빈 키는 같은 맵의 빈 plain 키와 중복이 되므로 다른 노드에 둔다
            + "  e3:\n    type: human_task\n    outcomes:\n      \"\": { to: end }\n"
            + "  null: { type: end }\n"
            + TAIL;

    ParseResult r = parse(yaml);

    assertThat(r.model()).isNull();
    List<Integer> lines = r.problems().stream().map(WorkflowProblem::line).toList();
    assertThat(codes(r)).containsOnly("SCHEMA_VALUE");
    assertThat(lines)
        .containsExactly(
            lineOf(yaml, "null: { to: end }"),
            lineOf(yaml, "~: { to: end }"),
            lineOf(yaml, "? "),
            lineOf(yaml, h101),
            lineOf(yaml, "\"\": { to: end }"),
            lineOf(yaml, "  null: { type: end }"));
  }

  @Test
  @DisplayName("편집기에서 줄 바꿈으로 안 보이는 U+2028·U+0085 는 주석·블록 안에서도 그 자리에서 거절")
  void hiddenLineBreaks_rejected() {
    String comment =
        HEAD + "nodes:\n" + START_END + "  # 주석처럼 보인다\u2028  x: { type: end }\n" + TAIL;
    ParseResult c = parse(comment);
    assertThat(codes(c)).containsExactly("YAML_INVALID_TEXT");
    assertThat(c.problems().get(0).line()).isEqualTo(lineOf(comment, "주석처럼"));
    assertThat(c.problems().get(0).column()).isEqualTo("  # 주석처럼 보인다".length() + 1);

    String block =
        HEAD
            + "nodes:\n"
            + START_END
            + "  a:\n    type: agent_task\n    role: owner\n    instructions: |\n      가\u0085나\n"
            + TAIL;
    ParseResult b = parse(block);
    assertThat(codes(b)).containsExactly("YAML_INVALID_TEXT");
    assertThat(b.problems().get(0).column()).isEqualTo("      가".length() + 1);
    assertThat(b.model()).isNull();
  }

  @Test
  @DisplayName("문구에 되비추는 키·값은 짧게 잘리고 nodeKey 는 100자, 문구는 500자 안")
  void problemOutput_isBounded() {
    String hugeKey = "a".repeat(120_000);
    // 한 줄 단순 키는 SnakeYAML 이 1024자까지만 받으므로 긴 키는 명시 키(? )로 쓴다
    String top = HEAD + "nodes: {}\nstart: []\n? " + hugeKey + "\n: 1\n";
    ParseResult t = parse(top);
    assertThat(codes(t)).containsExactly("SCHEMA_FIELD_UNKNOWN");
    assertThat(t.problems().get(0).message().length()).isLessThanOrEqualTo(500);

    String nested =
        HEAD
            + "nodes:\n"
            + START_END
            + "  "
            + "k".repeat(100)
            + ":\n    type: end\n    ? "
            + hugeKey
            + "\n    : 1\n"
            + TAIL;
    ParseResult n = parse(nested);
    assertThat(n.problems()).isNotEmpty();
    assertThat(n.problems())
        .allSatisfy(
            p -> {
              assertThat(p.message().length()).isLessThanOrEqualTo(500);
              assertThat(p.nodeKey() == null || p.nodeKey().length() <= 100).isTrue();
            });

    String tooLongDuration =
        HEAD
            + "nodes:\n"
            + START_END
            + "  h: { type: human_task, role: owner, timeout: { after: "
            + "9".repeat(100_000)
            + " } }\n"
            + TAIL;
    ParseResult d = parse(tooLongDuration);
    assertThat(codes(d)).containsExactly("DURATION_INVALID");
    assertThat(d.problems().get(0).message().length()).isLessThan(300);
  }

  @Test
  @DisplayName("크기 규칙은 parse 와 같은 isTooLarge 로 공개된다(UTF-8 바이트 262144 가 경계)")
  void isTooLarge_sameRuleAsParse() {
    assertThat(WorkflowYamlParser.isTooLarge("a".repeat(262_144))).isFalse();
    assertThat(WorkflowYamlParser.isTooLarge("a".repeat(262_145))).isTrue();
    assertThat(WorkflowYamlParser.isTooLarge("가".repeat(87_381))).isFalse();
    assertThat(WorkflowYamlParser.isTooLarge("가".repeat(87_382))).isTrue();
    assertThat(WorkflowYamlParser.isTooLarge(null)).isFalse();
    assertThat(codes(parse("a".repeat(262_145)))).containsExactly("YAML_TOO_LARGE");
  }

  /** use 한 줄로 공용 지시 a 를 count 번 잇는 노드 하나짜리 정의(공용 지시 a 는 length 자). */
  private static String sharedExpansion(int length, int count, String own) {
    String uses = String.join(", ", java.util.Collections.nCopies(count, "a"));
    return HEAD.replace("roles:", "shared:\n  a: " + "x".repeat(length) + "\nroles:")
        + "nodes:\n"
        + START_END
        + "  n:\n    type: agent_task\n    role: owner\n    use: ["
        + uses
        + "]\n"
        + (own == null ? "" : "    instructions: " + own + "\n")
        + TAIL;
  }

  @Test
  @DisplayName("use 로 펼친 지시 합계는 1,048,576자까지 — 정확히 상한은 통과, 정확히 1자 넘으면 YAML_EXPANSION_TOO_LARGE")
  void useExpansion_boundary() {
    // 174761 * 6 + 2 * 5 = 1048576 (정확히 상한)
    ParseResult atCap = parse(sharedExpansion(174_761, 6, null));
    assertThat(atCap.problems()).isEmpty();
    assertThat(atCap.model().nodes().get("n").instructions()).hasSize(1_048_576);

    // 다른 노드의 글 한 자가 합계를 정확히 1,048,577 로 만든다(결합 구분자 없이 지시 하나만 1자)
    String over =
        sharedExpansion(174_761, 6, null)
            .replace(
                "start:\n  - { when",
                "  m: { type: agent_task, role: owner, instructions: y }\nstart:\n  - { when");
    ParseResult r = parse(over);
    assertThat(codes(r)).containsExactly("YAML_EXPANSION_TOO_LARGE");
    assertThat(r.problems().get(0).nodeKey()).isEqualTo("m");
    assertThat(r.problems().get(0).line()).isEqualTo(lineOf(over, "  m: {"));
    assertThat(r.model()).isNull();
  }

  @Test
  @DisplayName("노드마다 조금씩 써서 문서 합계가 넘는 경우도 넘긴 첫 노드에서 한 번만 알린다")
  void useExpansion_acrossNodes() {
    StringBuilder nodes = new StringBuilder();
    for (int i = 1; i <= 30; i++) {
      nodes
          .append("  n")
          .append(i)
          .append(": { type: agent_task, role: owner, use: [a, a, a, a] }\n");
    }
    String yaml =
        HEAD.replace("roles:", "shared:\n  a: " + "x".repeat(10_000) + "\nroles:")
            + "nodes:\n"
            + START_END
            + nodes
            + TAIL;

    ParseResult r = parse(yaml);

    // 노드 하나가 40006자 — 26개(1,040,156)까지 들어가고 27번째에서 넘는다
    assertThat(codes(r)).containsExactly("YAML_EXPANSION_TOO_LARGE");
    assertThat(r.problems().get(0).nodeKey()).isEqualTo("n27");
    assertThat(r.problems().get(0).line()).isEqualTo(lineOf(yaml, "  n27:"));
  }

  @Test
  @DisplayName("상한에 닿은 정의(키 100자·펼친 지시 1,048,576자)도 JSON 으로 쓰고 다시 읽는다")
  void limits_roundTripThroughJson() {
    String key = "k".repeat(100);
    String yaml =
        sharedExpansion(174_761, 6, null)
            .replace("a: x", key + ": x")
            .replace("a, ", key + ", ")
            .replace(", a]", ", " + key + "]");
    ParseResult r = parse(yaml);

    assertThat(r.problems()).isEmpty();
    WorkflowModel m = r.model();
    assertThat(WorkflowModelJson.read(WorkflowModelJson.write(m))).isEqualTo(m);
  }

  @Test
  @DisplayName("timeout.then 은 생략할 수 있고 모델에서는 null, JSON 으로도 왕복한다")
  void timeoutThen_optional() {
    String yaml =
        HEAD
            + "nodes:\n"
            + START_END
            + "  h: { type: human_task, role: owner, timeout: { after: P3D } }\n"
            + "  g: { type: human_task, role: owner, timeout: { then: remind } }\n"
            + TAIL;
    ParseResult r = parse(yaml);

    assertThat(codes(r)).containsExactly("SCHEMA_REQUIRED");
    assertThat(r.problems().get(0).nodeKey()).isEqualTo("g");

    ParseResult ok =
        parse(
            yaml.replace(
                "  g: { type: human_task, role: owner, timeout: { then: remind } }\n", ""));
    assertThat(ok.problems()).isEmpty();
    WorkflowModel.Timeout t = ok.model().nodes().get("h").timeout();
    assertThat(t.after()).isEqualTo(Duration.ofDays(3));
    assertThat(t.then()).isNull();
    assertThat(WorkflowModelJson.read(WorkflowModelJson.write(ok.model()))).isEqualTo(ok.model());
  }

  @Test
  @DisplayName("크기 상한은 UTF-8 바이트 기준, 깊이 50 은 허용")
  void limits_atBoundary() {
    assertThat(codes(parse("a".repeat(262_144)))).doesNotContain("YAML_TOO_LARGE");
    // 한글은 글자당 3바이트 — 글자 수로는 작아도 바이트로 넘으면 거절
    assertThat(codes(parse("가".repeat(87_382)))).contains("YAML_TOO_LARGE");
    assertThat(codes(parse("[".repeat(50) + "]".repeat(50)))).doesNotContain("YAML_TOO_DEEP");
    assertThat(codes(parse("[".repeat(100_000)))).contains("YAML_TOO_DEEP");
    assertThat(codes(parse(null))).containsExactly("YAML_EMPTY");
  }

  @Test
  @DisplayName("decision 의 조건 목록과 context/equals 타입을 읽는다")
  void decisionAndContextCondition_parsed() {
    String yaml =
        HEAD
            + "nodes:\n"
            + START_END
            + "  route:\n"
            + "    type: decision\n"
            + "    conditions:\n"
            + "      - { when: { context: plan.planDoc, equals: \"x\" }, to: end }\n"
            + "      - { when: { context: plan.n, equals: 5 }, to: end }\n"
            + "      - { when: { context: plan.f, equals: 1.5 }, to: end }\n"
            + "      - { when: { context: plan.b, equals: true }, to: end }\n"
            + "      - { when: { context: plan.q, equals: \"5\" }, to: end }\n"
            + "      - { when: { context: plan.y, equals: yes }, to: end }\n"
            + "      - { when: { assigneeRole: owner }, to: end }\n"
            + "    default: end\n"
            + TAIL;

    ParseResult r = parse(yaml);

    assertThat(r.problems()).isEmpty();
    WorkflowModel.Node route = r.model().nodes().get("route");
    assertThat(route.defaultTo()).isEqualTo("end");
    assertThat(route.conditions())
        .containsExactly(
            new WorkflowModel.Condition(null, "plan.planDoc", "x", "end"),
            new WorkflowModel.Condition(null, "plan.n", 5L, "end"),
            new WorkflowModel.Condition(null, "plan.f", 1.5, "end"),
            new WorkflowModel.Condition(null, "plan.b", true, "end"),
            new WorkflowModel.Condition(null, "plan.q", "5", "end"),
            new WorkflowModel.Condition(null, "plan.y", "yes", "end"),
            new WorkflowModel.Condition("owner", null, null, "end"));
    assertThat(r.model().start())
        .containsExactly(new WorkflowModel.Condition("owner", null, null, "end"));
  }

  @Test
  @DisplayName("timeout.after 는 0 보다 큰 ISO-8601 기간만 — 아니면 DURATION_INVALID")
  void durationInvalid() {
    for (String bad : List.of("2일", "PT0S", "-PT1H")) {
      String yaml =
          HEAD
              + "nodes:\n"
              + START_END
              + "  h:\n"
              + "    type: human_task\n"
              + "    role: owner\n"
              + "    timeout: { after: "
              + bad
              + ", then: remind }\n"
              + TAIL;

      ParseResult r = parse(yaml);

      assertThat(codes(r)).as(bad).containsExactly("DURATION_INVALID");
      assertThat(r.problems().get(0).nodeKey()).isEqualTo("h");
      assertThat(r.problems().get(0).line()).isEqualTo(lineOf(yaml, "timeout:"));
      assertThat(r.model()).isNull();
    }
  }

  @Test
  @DisplayName("yes/no/2026 같은 YAML 암묵 타입 값도 적힌 글 그대로 남긴다")
  void yamlImplicitTypes_keepWrittenText() {
    String yaml =
        HEAD
            + "nodes:\n"
            + START_END
            + "  h:\n"
            + "    type: human_task\n"
            + "    name: 2026\n"
            + "    role: owner\n"
            + "    outcomes:\n"
            + "      yes: { to: end }\n"
            + "      no: { to: end, assignTo: 1e3 }\n"
            + "      2026-01-01: { to: end }\n"
            + TAIL;

    ParseResult r = parse(yaml);

    assertThat(r.problems()).isEmpty();
    WorkflowModel.Node h = r.model().nodes().get("h");
    assertThat(h.name()).isEqualTo("2026");
    assertThat(h.outcomes().keySet()).containsExactly("yes", "no", "2026-01-01");
    assertThat(h.outcomes().get("no").assignTo()).isEqualTo("1e3");
  }

  @Test
  @DisplayName("CRLF·BOM·한글이 있어도 줄·열이 편집기 기준(1부터, BOM 제외)과 같다")
  void crlfBomKorean_positionMatchesEditor() {
    String yaml =
        "\uFEFFschema: genia/workflow@1\r\n"
            + "name: 한글 이름\r\n"
            + "roles:\r\n"
            + "  owner: { members: [가나다], 별명: x }\r\n"
            + "nodes: {}\r\n"
            + "start: []\r\n";

    ParseResult r = parse(yaml);

    assertThat(codes(r)).contains("SCHEMA_FIELD_UNKNOWN");
    WorkflowProblem p =
        r.problems().stream()
            .filter(x -> x.code().equals("SCHEMA_FIELD_UNKNOWN"))
            .findFirst()
            .get();
    assertThat(p.line()).isEqualTo(4);
    assertThat(p.column()).isEqualTo("  owner: { members: [가나다], ".length() + 1);
    // BOM 뒤 첫 줄의 첫 키 위치
    assertThat(r.source().at("schema").line()).isEqualTo(1);
    assertThat(r.source().at("schema").column()).isEqualTo(1);
    assertThat(r.source().at("name").line()).isEqualTo(2);

    ParseResult broken = parse("\uFEFFa: 1\r\nb: [\r\n");
    assertThat(broken.problems().get(0).line()).isEqualTo(3);
    assertThat(broken.problems().get(0).column()).isEqualTo(1);
  }

  @Test
  @DisplayName("NUL 문자는 원문에 있든 이스케이프로 만들든 YAML_INVALID_TEXT")
  void nulEscape_isError() {
    String escaped = HEAD.replace("name: t", "name: \"a\\0b\"") + "nodes: {}\nstart: []\n";
    String raw = HEAD.replace("name: t", "name: a\u0000b") + "nodes: {}\nstart: []\n";
    String surrogate = HEAD.replace("name: t", "name: \"\\uD800\"") + "nodes: {}\nstart: []\n";

    assertThat(codes(parse(escaped))).contains("YAML_INVALID_TEXT");
    assertThat(parse(escaped).model()).isNull();
    assertThat(codes(parse(raw))).containsExactly("YAML_INVALID_TEXT");
    assertThat(parse(raw).problems().get(0).line()).isEqualTo(2);
    assertThat(codes(parse(surrogate))).contains("YAML_INVALID_TEXT");
  }

  @Test
  @DisplayName("위치표: 없는 경로는 가장 가까운 부모, 끝내 없으면 1:1")
  void sourceMap_fallsBackToParent() throws IOException {
    String yaml = spec();
    ParseResult r = parse(yaml);

    assertThat(r.source().has("nodes.dev.outcomes.ask.to")).isTrue();
    assertThat(r.source().has("nodes.dev.outcomes.zzz")).isFalse();
    assertThat(r.source().at("nodes.dev.outcomes.zzz.to"))
        .isEqualTo(r.source().at("nodes.dev.outcomes"));
    assertThat(r.source().at("nodes.dev.outcomes.ask.to").line())
        .isEqualTo(lineOf(yaml, "ask:       { to: dev_ask"));
    assertThat(r.source().at("start.2.to").line())
        .isEqualTo(lineOf(yaml, "assigneeRole: developer"));
    assertThat(SourceMap.empty().at("nodes.x")).isEqualTo(new SourceMap.Pos(1, 1));
    assertThat(SourceMap.empty().has("nodes")).isFalse();
    assertThat(new ArrayList<>(r.problems())).isEmpty();
  }

  @Test
  @DisplayName("크기 상한 안의 한 줄 문서에서 문제는 정확히 100건에서 멈추고 크기 거절이 아니다")
  void maxSizeFlatDocument_capsProblemsAtHundred() {
    StringBuilder sb = new StringBuilder(HEAD).append("nodes: {}\nstart: [");
    for (int i = 0; i < 25_000; i++) {
      sb.append("{ x: 1 },");
    }
    sb.append("]\n");
    String yaml = sb.toString();
    assertThat(WorkflowYamlParser.isTooLarge(yaml)).isFalse();

    ParseResult r = parse(yaml);

    assertThat(r.model()).isNull();
    assertThat(r.problems()).hasSize(100);
    assertThat(codes(r)).doesNotContain("YAML_TOO_LARGE").allMatch(c -> c.startsWith("SCHEMA_"));
  }

  /** WorkflowYamlParser 로거에 붙여 error 로그를 모으는 appender. */
  private static ch.qos.logback.core.read.ListAppender<ch.qos.logback.classic.spi.ILoggingEvent>
      attachAppender() {
    var appender =
        new ch.qos.logback.core.read.ListAppender<ch.qos.logback.classic.spi.ILoggingEvent>();
    appender.start();
    ((ch.qos.logback.classic.Logger) org.slf4j.LoggerFactory.getLogger(WorkflowYamlParser.class))
        .addAppender(appender);
    return appender;
  }

  private static void detachAppender(
      ch.qos.logback.core.read.ListAppender<ch.qos.logback.classic.spi.ILoggingEvent> appender) {
    ((ch.qos.logback.classic.Logger) org.slf4j.LoggerFactory.getLogger(WorkflowYamlParser.class))
        .detachAppender(appender);
    appender.stop();
  }

  @Test
  @DisplayName("스캐너가 던지는 잘못된 이스케이프(\\U80000000 등)는 문법 오류이고 error 로그를 남기지 않는다")
  void badEscapes_areSyntaxErrorsWithoutErrorLog() {
    String[] escapes = {"\\U80000000", "\\UFFFFFFFF", "\\U7FFFFFFF", "\\U00110000", "\\uD800"};
    var appender = attachAppender();
    try {
      for (int i = 0; i < escapes.length; i++) {
        String yaml =
            HEAD.replace("name: t", "name: \"" + escapes[i] + "\"") + "nodes: {}\nstart: []\n";
        ParseResult r = parse(yaml);
        assertThat(r.model()).as(escapes[i]).isNull();
        assertThat(r.problems()).as(escapes[i]).isNotEmpty();
        if (i < 4) {
          assertThat(codes(r)).as(escapes[i]).contains("YAML_SYNTAX");
          assertThat(r.problems()).as(escapes[i]).noneMatch(p -> p.message().contains("알 수 없는 문제"));
        }
      }
      assertThat(appender.list).as("예상한 문법 오류는 로그하지 않는다").isEmpty();
    } finally {
      detachAppender(appender);
    }
  }

  @Test
  @DisplayName("같은 자리의 서로 다른 필수 필드 누락은 모두 알린다")
  void requiredFields_samePositionAllReported() {
    assertThat(codes(parse("schema: genia/workflow@1\n")))
        .containsExactly(
            "SCHEMA_REQUIRED", "SCHEMA_REQUIRED", "SCHEMA_REQUIRED", "SCHEMA_REQUIRED");
    assertThat(codes(parse("{}\n"))).hasSize(5).containsOnly("SCHEMA_REQUIRED");

    ParseResult start = parse(HEAD + "nodes:\n" + START_END + "start: [ {} ]\n");
    assertThat(start.problems().stream().map(WorkflowProblem::message).toList())
        .anyMatch(m -> m.contains("'when'"))
        .anyMatch(m -> m.contains("'to'"));

    ParseResult layout = parse(HEAD + "nodes:\n" + START_END + TAIL + "layout: { a: {} }\n");
    assertThat(layout.problems().stream().map(WorkflowProblem::message).toList())
        .anyMatch(m -> m.contains("'x'"))
        .anyMatch(m -> m.contains("'y'"));
  }

  @Test
  @DisplayName("ask 줄임이 만들 노드 키도 100자까지다 — 넘으면 ask 줄의 오류")
  void askShorthand_expandedKeyLimit() {
    assertThat(parse(askDoc("k".repeat(96))).model().nodes()).containsKey("k".repeat(96) + "_ask");

    String yaml = askDoc("k".repeat(97));
    ParseResult r = parse(yaml);

    assertThat(r.model()).isNull();
    assertThat(codes(r)).containsExactly("ASK_KEY_TOO_LONG");
    assertThat(r.problems().get(0).line()).isEqualTo(lineOf(yaml, "ask: {"));
  }

  @Test
  @DisplayName("자른 nodeKey 는 이모지를 반으로 쪼개지 않는다")
  void clippedNodeKey_keepsSurrogatePairs() {
    String emoji = new String(Character.toChars(0x1F600));
    ParseResult r = parse(askDoc("a" + emoji.repeat(99)));

    List<String> keys = r.problems().stream().map(p -> p.nodeKey()).filter(k -> k != null).toList();
    assertThat(keys).isNotEmpty();
    for (String key : keys) {
      assertThat(key.length()).isLessThanOrEqualTo(100);
      assertThat(Character.isHighSurrogate(key.charAt(key.length() - 1))).isFalse();
    }
  }

  /** ask 줄임을 쓰는 agent_task 하나짜리 문서(노드 키만 바꾼다). */
  private static String askDoc(String key) {
    return "schema: genia/workflow@1\nname: t\nroles:\n  owner: { members: [o@example.com] }\n"
        + "nodes:\n  start: { type: start }\n  end: { type: end }\n  "
        + key
        + ":\n    type: agent_task\n    role: owner\n    ask: { role: owner }\n"
        + "    outcomes: { done: { to: end } }\n"
        + "start:\n  - { when: { assigneeRole: owner }, to: end }\n";
  }
}
