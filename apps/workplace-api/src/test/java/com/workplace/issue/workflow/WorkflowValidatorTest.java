package com.workplace.issue.workflow;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.issue.workflow.domain.ParseResult;
import com.workplace.issue.workflow.domain.ProjectMembers;
import com.workplace.issue.workflow.domain.SourceMap;
import com.workplace.issue.workflow.domain.WorkflowModel;
import com.workplace.issue.workflow.domain.WorkflowValidator;
import com.workplace.issue.workflow.domain.WorkflowYamlParser;
import com.workplace.issue.workflow.dto.WorkflowProblem;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/** 워크플로우 정적 검증기의 규칙·위치·상한을 DB 없이 확인한다(WP-1984). YAML 은 파서를 거쳐 줄이 진짜 줄이다. */
class WorkflowValidatorTest {

  private static final String ROLES_OWNER = "roles:\n  owner: { members: [owner@example.com] }\n";
  private static final String START_NODE = "  start: { type: start }\n";
  private static final String END_NODE = "  end: { type: end }\n";
  private static final String WORK =
      "  work: { type: human_task, role: owner, outcomes: { done: { to: end } } }\n";
  private static final String START_TO_WORK =
      "start:\n  - { when: { assigneeRole: owner }, to: work }\n";

  private static String wf(String roles, String nodes, String start) {
    return "schema: genia/workflow@1\nname: t\n" + roles + "nodes:\n" + nodes + start;
  }

  /** 모든 역할 구성원을 프로젝트 사람 구성원으로 만든 표. */
  private static ProjectMembers everyone(WorkflowModel m) {
    List<ProjectMembers.Member> list = new ArrayList<>();
    m.roles()
        .values()
        .forEach(
            r ->
                r.memberUsernames()
                    .forEach(u -> list.add(new ProjectMembers.Member(u, "USER", null))));
    return ProjectMembers.of(list);
  }

  private static List<WorkflowProblem> validate(String yaml) {
    ParseResult r = WorkflowYamlParser.parse(yaml);
    assertThat(r.model()).as("파서 문제: %s", r.problems()).isNotNull();
    return WorkflowValidator.validate(r.model(), everyone(r.model()), r.source());
  }

  private static List<WorkflowProblem> validate(String yaml, ProjectMembers members) {
    ParseResult r = WorkflowYamlParser.parse(yaml);
    assertThat(r.model()).as("파서 문제: %s", r.problems()).isNotNull();
    return WorkflowValidator.validate(r.model(), members, r.source());
  }

  private static List<WorkflowProblem> with(List<WorkflowProblem> ps, String code) {
    return ps.stream().filter(p -> p.code().equals(code)).toList();
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

  /** code 문제가 정확히 이 줄에 하나 있고 심각도·nodeKey 가 맞는지 단언하고 돌려준다. */
  private static WorkflowProblem expect(
      List<WorkflowProblem> ps, String code, String severity, String nodeKey, int line) {
    List<WorkflowProblem> hits =
        ps.stream().filter(p -> p.code().equals(code) && p.line() == line).toList();
    assertThat(hits).as("%s @%d in %s", code, line, ps).hasSize(1);
    assertThat(hits.get(0).severity()).isEqualTo(severity);
    assertThat(hits.get(0).nodeKey()).isEqualTo(nodeKey);
    assertThat(hits.get(0).column()).isGreaterThanOrEqualTo(1);
    return hits.get(0);
  }

  private static WorkflowModel.Node hand(
      String key, String type, String role, Map<String, WorkflowModel.Outcome> outcomes) {
    return new WorkflowModel.Node(
        key,
        type,
        null,
        role,
        null,
        List.of(),
        List.of(),
        Map.of(),
        new LinkedHashMap<>(outcomes),
        List.of(),
        null,
        null,
        null,
        null,
        null);
  }

  private static String spec() throws IOException {
    return Files.readString(
        Path.of("src/test/resources/workflow/spec-example.yaml"), StandardCharsets.UTF_8);
  }

  @Test
  @DisplayName("가장 작은 유효 정의는 문제가 없다")
  void minimalDocument_hasNoProblems() {
    assertThat(validate(wf(ROLES_OWNER, START_NODE + WORK + END_NODE, START_TO_WORK))).isEmpty();
  }

  @Test
  @DisplayName("없는 노드를 가리키는 to·default·onError.to·returnTo·start 는 REF_NODE_UNKNOWN")
  void unknownTarget() {
    String yaml =
        wf(
            ROLES_OWNER,
            START_NODE
                + "  route:\n    type: decision\n    conditions:\n"
                + "      - { when: { assigneeRole: owner }, to: ghost1 }\n"
                + "    default: ghost2\n"
                + "  work:\n    type: human_task\n    role: owner\n    returnTo: ghost4\n"
                + "    onError: { to: ghost3 }\n    outcomes:\n      done: { to: end }\n"
                + END_NODE,
            "start:\n  - { when: { assigneeRole: owner }, to: ghost0 }\n");

    List<WorkflowProblem> ps = validate(yaml);

    assertThat(with(ps, "REF_NODE_UNKNOWN")).hasSize(5);
    expect(ps, "REF_NODE_UNKNOWN", "ERROR", null, lineOf(yaml, "to: ghost0"));
    expect(ps, "REF_NODE_UNKNOWN", "ERROR", "route", lineOf(yaml, "to: ghost1"));
    expect(ps, "REF_NODE_UNKNOWN", "ERROR", "route", lineOf(yaml, "default: ghost2"));
    expect(ps, "REF_NODE_UNKNOWN", "ERROR", "work", lineOf(yaml, "to: ghost3"));
    expect(ps, "REF_NODE_UNKNOWN", "ERROR", "work", lineOf(yaml, "returnTo: ghost4"));
    assertThat(with(ps, "RETURN_TO_WITHOUT_ASK")).isEmpty();
    assertThat(ps).extracting(WorkflowProblem::line).isSortedAccordingTo(Comparator.naturalOrder());
  }

  @Test
  @DisplayName("없는 역할을 가리키는 role·assignTo·assigneeRole 은 REF_ROLE_UNKNOWN, keep 은 제외")
  void unknownRole() {
    String yaml =
        wf(
            ROLES_OWNER,
            START_NODE
                + "  route:\n    type: decision\n    conditions:\n"
                + "      - { when: { assigneeRole: ghost_d }, to: work }\n"
                + "    default: work\n"
                + "  work:\n    type: human_task\n    role: ghost_r\n"
                + "    onError:\n      to: end\n      assignTo: ghost_b\n"
                + "    outcomes:\n"
                + "      a:\n        to: end\n        assignTo: ghost_a\n"
                + "      k:\n        to: end\n        assignTo: keep\n"
                + END_NODE,
            "start:\n  - { when: { assigneeRole: ghost_c }, to: route }\n");

    List<WorkflowProblem> ps = validate(yaml);

    assertThat(with(ps, "REF_ROLE_UNKNOWN")).hasSize(5);
    expect(ps, "REF_ROLE_UNKNOWN", "ERROR", null, lineOf(yaml, "assigneeRole: ghost_c"));
    expect(ps, "REF_ROLE_UNKNOWN", "ERROR", "route", lineOf(yaml, "assigneeRole: ghost_d"));
    expect(ps, "REF_ROLE_UNKNOWN", "ERROR", "work", lineOf(yaml, "role: ghost_r"));
    expect(ps, "REF_ROLE_UNKNOWN", "ERROR", "work", lineOf(yaml, "assignTo: ghost_b"));
    expect(ps, "REF_ROLE_UNKNOWN", "ERROR", "work", lineOf(yaml, "assignTo: ghost_a"));
  }

  @Test
  @DisplayName("없는 shared 를 쓰면 REF_SHARED_UNKNOWN")
  void unknownShared() {
    String yaml =
        wf(
            ROLES_OWNER + "shared:\n  base: hello\n",
            START_NODE
                + "  work:\n    type: human_task\n    role: owner\n    use: [base, missing]\n"
                + "    outcomes: { done: { to: end } }\n"
                + END_NODE,
            START_TO_WORK);

    List<WorkflowProblem> ps = validate(yaml);

    assertThat(with(ps, "REF_SHARED_UNKNOWN")).hasSize(1);
    expect(ps, "REF_SHARED_UNKNOWN", "ERROR", "work", lineOf(yaml, "use: [base, missing]"));
  }

  @Test
  @DisplayName("shared 이름에 점이 있어도 그 use 항목에 정확히 건다")
  void sharedKeyWithDot_locatesTheItem() {
    String yaml =
        wf(
            ROLES_OWNER + "shared:\n  x.y: hello\n",
            START_NODE
                + "  work:\n    type: human_task\n    role: owner\n    use:\n"
                + "      - x.y\n      - x.z\n"
                + "    outcomes: { done: { to: end } }\n"
                + END_NODE,
            START_TO_WORK);

    List<WorkflowProblem> ps = validate(yaml);

    assertThat(with(ps, "REF_SHARED_UNKNOWN")).hasSize(1);
    expect(ps, "REF_SHARED_UNKNOWN", "ERROR", "work", lineOf(yaml, "- x.z"));
  }

  @Test
  @DisplayName("역할 구성원이 프로젝트에 없으면 그 구성원 줄에 ROLE_MEMBER_NOT_IN_PROJECT")
  void roleMemberNotInProject() {
    String yaml =
        wf(
            "roles:\n  owner:\n    members:\n      - owner@example.com\n      - ghost@example.com\n",
            START_NODE + WORK + END_NODE,
            START_TO_WORK);
    ProjectMembers pm =
        ProjectMembers.of(List.of(new ProjectMembers.Member("owner@example.com", "USER", null)));

    List<WorkflowProblem> ps = validate(yaml, pm);

    assertThat(with(ps, "ROLE_MEMBER_NOT_IN_PROJECT")).hasSize(1);
    expect(ps, "ROLE_MEMBER_NOT_IN_PROJECT", "ERROR", null, lineOf(yaml, "- ghost@example.com"));
  }

  @Test
  @DisplayName("start 노드가 0개나 2개면 START_COUNT 이고 도달 검사는 건너뛴다")
  void zeroOrTwoStarts() {
    String zero = wf(ROLES_OWNER, WORK + END_NODE, START_TO_WORK);
    List<WorkflowProblem> psZero = validate(zero);
    expect(psZero, "START_COUNT", "ERROR", null, lineOf(zero, "nodes:"));
    assertThat(with(psZero, "NODE_UNREACHABLE")).isEmpty();

    String two =
        wf(
            ROLES_OWNER,
            START_NODE + "  start2: { type: start }\n" + WORK + END_NODE,
            START_TO_WORK);
    List<WorkflowProblem> psTwo = validate(two);
    expect(psTwo, "START_COUNT", "ERROR", "start2", lineOf(two, "start2:"));
    assertThat(with(psTwo, "NODE_UNREACHABLE")).isEmpty();
  }

  @Test
  @DisplayName("최상위 start 목록이 비면 START_CONDITIONS_EMPTY, start 노드의 막다름은 따로 내지 않는다")
  void emptyStartList() {
    String yaml = wf(ROLES_OWNER, START_NODE + WORK + END_NODE, "start: []\n");

    List<WorkflowProblem> ps = validate(yaml);

    expect(ps, "START_CONDITIONS_EMPTY", "ERROR", null, lineOf(yaml, "start: []"));
    assertThat(with(ps, "NODE_DEAD_END"))
        .extracting(WorkflowProblem::nodeKey)
        .doesNotContain("start");
  }

  @Test
  @DisplayName("start 로 들어오는 연결은 START_INCOMING")
  void edgeIntoStart() {
    String yaml =
        wf(
            ROLES_OWNER,
            START_NODE
                + "  work:\n    type: human_task\n    role: owner\n    outcomes:\n"
                + "      done: { to: end }\n      back: { to: start }\n"
                + END_NODE,
            START_TO_WORK);

    List<WorkflowProblem> ps = validate(yaml);

    assertThat(with(ps, "START_INCOMING")).hasSize(1);
    expect(ps, "START_INCOMING", "ERROR", "work", lineOf(yaml, "back: { to: start }"));
  }

  @Test
  @DisplayName("end 가 없으면 END_MISSING 이고 막다름 검사는 건너뛴다")
  void noEnd() {
    String yaml =
        wf(
            ROLES_OWNER,
            START_NODE
                + "  work: { type: human_task, role: owner, outcomes: { again: { to: work } } }\n",
            START_TO_WORK);

    List<WorkflowProblem> ps = validate(yaml);

    expect(ps, "END_MISSING", "ERROR", null, lineOf(yaml, "nodes:"));
    assertThat(with(ps, "NODE_DEAD_END")).isEmpty();
  }

  @Test
  @DisplayName("start 에서 닿지 않는 노드는 NODE_UNREACHABLE, onError 로만 닿는 노드는 닿는 것으로 센다")
  void unreachableNode() {
    String yaml =
        wf(
            ROLES_OWNER,
            START_NODE
                + "  work:\n    type: human_task\n    role: owner\n    onError: { to: rescue }\n"
                + "    outcomes: { done: { to: end } }\n"
                + "  rescue: { type: human_task, role: owner, outcomes: { done: { to: end } } }\n"
                + "  orphan: { type: human_task, role: owner, outcomes: { done: { to: end } } }\n"
                + END_NODE,
            START_TO_WORK);

    List<WorkflowProblem> ps = validate(yaml);

    assertThat(with(ps, "NODE_UNREACHABLE")).hasSize(1);
    expect(ps, "NODE_UNREACHABLE", "ERROR", "orphan", lineOf(yaml, "orphan:"));
  }

  @Test
  @DisplayName("end 까지 못 가는 노드는 NODE_DEAD_END, onError 로만 끝에 가는 것은 세지 않는다")
  void deadEndNode() {
    String yaml =
        wf(
            ROLES_OWNER,
            START_NODE
                + "  work:\n    type: human_task\n    role: owner\n    outcomes:\n"
                + "      done: { to: end }\n      a: { to: stuck }\n      b: { to: fixer }\n"
                + "  stuck: { type: human_task, role: owner, outcomes: { again: { to: stuck } } }\n"
                + "  fixer:\n    type: human_task\n    role: owner\n    onError: { to: end }\n"
                + "    outcomes: { again: { to: fixer } }\n"
                + END_NODE,
            START_TO_WORK);

    List<WorkflowProblem> ps = validate(yaml);

    assertThat(with(ps, "NODE_DEAD_END")).hasSize(2);
    expect(ps, "NODE_DEAD_END", "ERROR", "stuck", lineOf(yaml, "stuck: {"));
    expect(ps, "NODE_DEAD_END", "ERROR", "fixer", lineOf(yaml, "fixer:"));
  }

  @Test
  @DisplayName("default 없는 decision 은 DECISION_DEFAULT_MISSING")
  void decisionWithoutDefault() {
    String yaml =
        wf(
            ROLES_OWNER,
            START_NODE
                + "  route:\n    type: decision\n    conditions:\n"
                + "      - { when: { assigneeRole: owner }, to: work }\n"
                + WORK
                + END_NODE,
            "start:\n  - { when: { assigneeRole: owner }, to: route }\n");

    List<WorkflowProblem> ps = validate(yaml);

    assertThat(with(ps, "DECISION_DEFAULT_MISSING")).hasSize(1);
    expect(ps, "DECISION_DEFAULT_MISSING", "ERROR", "route", lineOf(yaml, "route:"));
  }

  @Test
  @DisplayName("decision 끼리만 도는 고리는 AUTO_LOOP 하나이고 maxVisits 경고를 더하지 않는다")
  void autoOnlyLoop() {
    String yaml =
        wf(
            ROLES_OWNER,
            START_NODE
                + "  loop_a:\n    type: decision\n    conditions:\n"
                + "      - { when: { assigneeRole: owner }, to: loop_b }\n    default: loop_b\n"
                + "  loop_b:\n    type: decision\n    conditions:\n"
                + "      - { when: { assigneeRole: owner }, to: loop_a }\n    default: loop_a\n"
                + WORK
                + END_NODE,
            "start:\n  - { when: { assigneeRole: owner }, to: loop_a }\n");

    List<WorkflowProblem> ps = validate(yaml);

    assertThat(with(ps, "AUTO_LOOP")).hasSize(1);
    expect(ps, "AUTO_LOOP", "ERROR", "loop_a", lineOf(yaml, "loop_a:"));
    assertThat(with(ps, "LOOP_WITHOUT_MAX_VISITS")).isEmpty();
  }

  @Test
  @DisplayName("agent·human task 에 role 이나 outcome 이 없으면 TASK_ROLE_MISSING·TASK_OUTCOME_MISSING")
  void taskWithoutOutcomeOrRole() {
    String yaml =
        wf(
            ROLES_OWNER,
            START_NODE
                + "  bare_agent: { type: agent_task }\n"
                + "  bare_human: { type: human_task }\n"
                + WORK
                + END_NODE,
            START_TO_WORK);

    List<WorkflowProblem> ps = validate(yaml);

    expect(ps, "TASK_ROLE_MISSING", "ERROR", "bare_agent", lineOf(yaml, "bare_agent:"));
    expect(ps, "TASK_OUTCOME_MISSING", "ERROR", "bare_agent", lineOf(yaml, "bare_agent:"));
    expect(ps, "TASK_ROLE_MISSING", "ERROR", "bare_human", lineOf(yaml, "bare_human:"));
    expect(ps, "TASK_OUTCOME_MISSING", "ERROR", "bare_human", lineOf(yaml, "bare_human:"));
    assertThat(with(ps, "NODE_DEAD_END"))
        .extracting(WorkflowProblem::nodeKey)
        .doesNotContain("bare_agent", "bare_human");
  }

  @Test
  @DisplayName("returnTo 가 가리킨 노드에 이 노드로 오는 ask 결과가 없으면 RETURN_TO_WITHOUT_ASK")
  void returnToWithoutAsk() {
    String answer =
        "  answer:\n    type: human_task\n    role: owner\n    returnTo: work\n"
            + "    outcomes: { done: { to: end } }\n";
    String bad = wf(ROLES_OWNER, START_NODE + WORK + answer + END_NODE, START_TO_WORK);

    List<WorkflowProblem> ps = validate(bad);

    assertThat(with(ps, "RETURN_TO_WITHOUT_ASK")).hasSize(1);
    expect(ps, "RETURN_TO_WITHOUT_ASK", "ERROR", "answer", lineOf(bad, "returnTo: work"));

    String work =
        "  work:\n    type: agent_task\n    role: owner\n    outcomes:\n"
            + "      done: { to: end }\n      ask: { to: answer }\n";
    String good = wf(ROLES_OWNER, START_NODE + work + answer + END_NODE, START_TO_WORK);
    assertThat(with(validate(good), "RETURN_TO_WITHOUT_ASK")).isEmpty();
  }

  @Test
  @DisplayName("wait·fork·join 은 NODE_TYPE_RESERVED(아직 지원하지 않음)이고 그 노드에는 종류 문제만 낸다")
  void reservedTypeWait_isError() {
    for (String type : List.of("wait", "fork", "join")) {
      String yaml =
          wf(
              ROLES_OWNER,
              START_NODE
                  + "  pause: { type: "
                  + type
                  + ", role: owner, outcomes: { again: { to: pause } } }\n"
                  + WORK
                  + END_NODE,
              START_TO_WORK);

      List<WorkflowProblem> ps = validate(yaml);

      WorkflowProblem p =
          expect(ps, "NODE_TYPE_RESERVED", "ERROR", "pause", lineOf(yaml, "pause:"));
      assertThat(p.message()).contains("아직 지원하지 않음");
      assertThat(with(ps, "NODE_FIELD_NOT_ALLOWED")).isEmpty();
      assertThat(with(ps, "NODE_DEAD_END")).isEmpty();
    }
  }

  @Test
  @DisplayName("모르는 종류와 type 이 없는 노드는 NODE_TYPE_UNKNOWN")
  void unknownType() {
    String yaml =
        wf(
            ROLES_OWNER,
            START_NODE + "  odd: { type: teleport, role: owner }\n" + WORK + END_NODE,
            START_TO_WORK);
    List<WorkflowProblem> ps = validate(yaml);
    assertThat(with(ps, "NODE_TYPE_UNKNOWN")).hasSize(1);
    expect(ps, "NODE_TYPE_UNKNOWN", "ERROR", "odd", lineOf(yaml, "odd:"));
    assertThat(with(ps, "NODE_FIELD_NOT_ALLOWED")).isEmpty();

    // type 이 아예 없는 노드는 파서가 막으므로 손으로 만든 모델로 확인한다(널 안전).
    LinkedHashMap<String, WorkflowModel.Node> nodes = new LinkedHashMap<>();
    nodes.put("blank", hand("blank", null, null, Map.of()));
    WorkflowModel m =
        new WorkflowModel("genia/workflow@1", "t", Map.of(), Map.of(), nodes, List.of(), Map.of());
    List<WorkflowProblem> manual = WorkflowValidator.validate(m, ProjectMembers.of(List.of()));
    assertThat(with(manual, "NODE_TYPE_UNKNOWN")).hasSize(1);
    assertThat(with(manual, "NODE_TYPE_UNKNOWN").get(0).nodeKey()).isEqualTo("blank");
  }

  @Test
  @DisplayName("종류에 없는 필드는 NODE_FIELD_NOT_ALLOWED(ask 포함)")
  void fieldNotAllowedForType() {
    String yaml =
        wf(
            ROLES_OWNER,
            START_NODE
                + "  work: { type: human_task, role: owner, outcomes: { done: { to: end } } }\n"
                + "  agt:\n    type: agent_task\n    role: owner\n    returnTo: work\n"
                + "    outcomes: { done: { to: end } }\n"
                + "  hum:\n    type: human_task\n    role: owner\n    ask: { role: owner }\n"
                + "    outcomes: { done: { to: end } }\n"
                + "  end:\n    type: end\n    role: owner\n",
            START_TO_WORK);

    List<WorkflowProblem> ps = validate(yaml);

    assertThat(with(ps, "NODE_FIELD_NOT_ALLOWED")).hasSize(3);
    expect(ps, "NODE_FIELD_NOT_ALLOWED", "ERROR", "agt", lineOf(yaml, "returnTo: work"));
    expect(ps, "NODE_FIELD_NOT_ALLOWED", "ERROR", "hum", lineOf(yaml, "ask: { role: owner }"));
    expect(ps, "NODE_FIELD_NOT_ALLOWED", "ERROR", "end", lineOf(yaml, "  end:") + 2);
  }

  @Test
  @DisplayName("노드 role 인 역할의 members 가 비면 역할마다 ROLE_EMPTY 하나(첫 노드)")
  void usedRoleWithoutMembers() {
    String yaml =
        wf(
            ROLES_OWNER + "  idle: { members: [] }\n",
            START_NODE
                + "  work: { type: human_task, role: owner, outcomes: { a: { to: w1 }, b: { to: w2 } } }\n"
                + "  w1: { type: human_task, role: idle, outcomes: { done: { to: end } } }\n"
                + "  w2: { type: human_task, role: idle, outcomes: { done: { to: end } } }\n"
                + END_NODE,
            START_TO_WORK);

    List<WorkflowProblem> ps = validate(yaml);

    assertThat(with(ps, "ROLE_EMPTY")).hasSize(1);
    expect(ps, "ROLE_EMPTY", "ERROR", "w1", lineOf(yaml, "idle:"));
  }

  @Test
  @DisplayName("outcome·onError 의 assignTo 역할과 도착 task 역할이 겹치지 않으면 ASSIGNEE_OUTSIDE_TARGET_ROLE")
  void assignToOutsideTargetRole() {
    String yaml =
        wf(
            ROLES_OWNER + "  dev: { members: [dev@example.com] }\n",
            START_NODE
                + "  work:\n    type: human_task\n    role: owner\n    outcomes:\n"
                + "      done: { to: end }\n"
                + "      hand:\n        to: dev_task\n        assignTo: owner\n"
                + "  dev_task:\n    type: human_task\n    role: dev\n"
                + "    onError:\n      to: work\n      assignTo: dev\n"
                + "    outcomes:\n      done: { to: end }\n      back: { to: work, assignTo: keep }\n"
                + END_NODE,
            START_TO_WORK);

    List<WorkflowProblem> ps = validate(yaml);

    assertThat(with(ps, "ASSIGNEE_OUTSIDE_TARGET_ROLE")).hasSize(2);
    expect(ps, "ASSIGNEE_OUTSIDE_TARGET_ROLE", "ERROR", "work", lineOf(yaml, "assignTo: owner"));
    expect(ps, "ASSIGNEE_OUTSIDE_TARGET_ROLE", "ERROR", "dev_task", lineOf(yaml, "assignTo: dev"));
  }

  @Test
  @DisplayName("start 의 assigneeRole 과 도착 task 역할이 겹치지 않으면 ASSIGNEE_OUTSIDE_TARGET_ROLE")
  void startRoleOutsideTargetRole() {
    String yaml =
        wf(
            ROLES_OWNER + "  dev: { members: [dev@example.com] }\n",
            START_NODE
                + "  dev_task: { type: human_task, role: dev, outcomes: { done: { to: end } } }\n"
                + END_NODE,
            "start:\n  - { when: { assigneeRole: owner }, to: dev_task }\n"
                + "  - { when: { assigneeRole: dev }, to: dev_task }\n");

    List<WorkflowProblem> ps = validate(yaml);

    assertThat(with(ps, "ASSIGNEE_OUTSIDE_TARGET_ROLE")).hasSize(1);
    expect(ps, "ASSIGNEE_OUTSIDE_TARGET_ROLE", "ERROR", null, lineOf(yaml, "assigneeRole: owner"));
  }

  @Test
  @DisplayName("어디서도 쓰이지 않는 역할은 ROLE_UNUSED 경고")
  void unusedRole() {
    String yaml =
        wf(
            ROLES_OWNER + "  spare: { members: [spare@example.com] }\n",
            START_NODE + WORK + END_NODE,
            START_TO_WORK);

    List<WorkflowProblem> ps = validate(yaml);

    assertThat(with(ps, "ROLE_UNUSED")).hasSize(1);
    expect(ps, "ROLE_UNUSED", "WARNING", null, lineOf(yaml, "spare:"));
  }

  @Test
  @DisplayName("maxVisits 없는 되돌아가는 고리는 LOOP_WITHOUT_MAX_VISITS 경고(고리마다 하나, 첫 노드)")
  void backEdgeWithoutMaxVisits() {
    String ping =
        "  ping:\n    type: human_task\n    role: owner\n    outcomes:\n"
            + "      next: { to: pong }\n      done: { to: end }\n";
    String pong =
        "  pong:\n    type: human_task\n    role: owner\n    outcomes:\n      back: { to: ping }\n";
    String start = "start:\n  - { when: { assigneeRole: owner }, to: ping }\n";

    String yaml = wf(ROLES_OWNER, START_NODE + ping + pong + END_NODE, start);
    List<WorkflowProblem> ps = validate(yaml);
    assertThat(with(ps, "LOOP_WITHOUT_MAX_VISITS")).hasSize(1);
    expect(ps, "LOOP_WITHOUT_MAX_VISITS", "WARNING", "ping", lineOf(yaml, "ping:"));

    String guarded =
        wf(ROLES_OWNER, START_NODE + ping + pong + "    maxVisits: 2\n" + END_NODE, start);
    assertThat(with(validate(guarded), "LOOP_WITHOUT_MAX_VISITS")).isEmpty();

    String self =
        wf(
            ROLES_OWNER,
            START_NODE
                + "  ping:\n    type: human_task\n    role: owner\n    outcomes:\n"
                + "      again: { to: ping }\n      done: { to: end }\n"
                + END_NODE,
            start);
    assertThat(with(validate(self), "LOOP_WITHOUT_MAX_VISITS")).hasSize(1);
  }

  @Test
  @DisplayName("human_task 로 가는 ask 결과가 없는 agent_task 는 ASK_PATH_MISSING 경고")
  void agentNodeWithoutAsk() {
    String yaml =
        wf(
            ROLES_OWNER,
            START_NODE
                + "  work: { type: agent_task, role: owner, outcomes: { done: { to: end } } }\n"
                + END_NODE,
            START_TO_WORK);
    List<WorkflowProblem> ps = validate(yaml);
    assertThat(with(ps, "ASK_PATH_MISSING")).hasSize(1);
    expect(ps, "ASK_PATH_MISSING", "WARNING", "work", lineOf(yaml, "work:"));

    String asked =
        wf(
            ROLES_OWNER,
            START_NODE
                + "  work:\n    type: agent_task\n    role: owner\n    ask: { role: owner }\n"
                + "    outcomes: { done: { to: end } }\n"
                + END_NODE,
            START_TO_WORK);
    assertThat(with(validate(asked), "ASK_PATH_MISSING")).isEmpty();
  }

  @Test
  @DisplayName("local-repo 가 필요한데 담당 역할에 내부 AI 가 있으면 CAPABILITY_MISSING 경고")
  void requiresCapabilityMissing() {
    String yaml =
        wf(
            "roles:\n  bot: { members: [bot@example.com] }\n",
            START_NODE
                + "  coder:\n    type: agent_task\n    role: bot\n    requires:\n      - local-repo\n"
                + "    outcomes: { done: { to: end } }\n"
                + END_NODE,
            "start:\n  - { when: { assigneeRole: bot }, to: coder }\n");

    List<WorkflowProblem> internal =
        validate(
            yaml,
            ProjectMembers.of(
                List.of(new ProjectMembers.Member("bot@example.com", "AGENT", "INTERNAL"))));
    assertThat(with(internal, "CAPABILITY_MISSING")).hasSize(1);
    expect(internal, "CAPABILITY_MISSING", "WARNING", "coder", lineOf(yaml, "- local-repo"));

    List<WorkflowProblem> external =
        validate(
            yaml,
            ProjectMembers.of(
                List.of(new ProjectMembers.Member("bot@example.com", "AGENT", "EXTERNAL"))));
    assertThat(with(external, "CAPABILITY_MISSING")).isEmpty();
  }

  @Test
  @DisplayName("local-repo 밖의 requires 는 CAPABILITY_UNKNOWN 경고")
  void unknownCapability() {
    String yaml =
        wf(
            ROLES_OWNER,
            START_NODE
                + "  work:\n    type: agent_task\n    role: owner\n    requires: [local-repo, gpu]\n"
                + "    outcomes: { done: { to: end } }\n"
                + END_NODE,
            START_TO_WORK);

    List<WorkflowProblem> ps = validate(yaml);

    assertThat(with(ps, "CAPABILITY_UNKNOWN")).hasSize(1);
    expect(
        ps, "CAPABILITY_UNKNOWN", "WARNING", "work", lineOf(yaml, "requires: [local-repo, gpu]"));
  }

  private static List<String> warningKeys(List<WorkflowProblem> ps) {
    return ps.stream()
        .map(p -> p.severity() + ":" + p.code() + ":" + p.nodeKey())
        .sorted()
        .toList();
  }

  private static final List<String> SPEC_WARNINGS =
      List.of(
          "WARNING:ASK_PATH_MISSING:plan",
          "WARNING:ASK_PATH_MISSING:review",
          "WARNING:ASK_PATH_MISSING:triage",
          "WARNING:LOOP_WITHOUT_MAX_VISITS:plan");

  @Test
  @DisplayName("상위 설계 예시는 ERROR 0, 경고는 ask 경로 triage·plan·review 와 plan 고리 하나뿐")
  void specExample_onlyExpectedWarnings() throws IOException {
    List<WorkflowProblem> ps = validate(spec());

    assertThat(ps).noneMatch(p -> p.severity().equals("ERROR"));
    assertThat(warningKeys(ps)).containsExactlyElementsOf(SPEC_WARNINGS);
  }

  @Test
  @DisplayName("ask 줄임으로 쓴 예시도 같은 경고를 낸다")
  void specExampleWithShorthand_sameWarnings() throws IOException {
    String spec = spec();
    String[] lines = spec.split("\n", -1);
    List<String> out = new ArrayList<>();
    boolean skipping = false;
    for (String line : lines) {
      if (line.startsWith("  dev_ask:")) {
        skipping = true;
      } else if (skipping && line.startsWith("  review:")) {
        skipping = false;
      }
      if (skipping || line.contains("ask:       { to: dev_ask")) {
        continue;
      }
      out.add(line);
      if (line.startsWith("    onError: { to: triage")) {
        out.add("    ask: { role: owner }");
      }
    }
    String yaml = String.join("\n", out);
    assertThat(yaml).contains("ask: { role: owner }").doesNotContain("dev_ask:");

    List<WorkflowProblem> ps = validate(yaml);

    assertThat(ps).noneMatch(p -> p.severity().equals("ERROR"));
    assertThat(warningKeys(ps)).containsExactlyElementsOf(SPEC_WARNINGS);
  }

  @Test
  @DisplayName("고리 경고 수는 노드 정의 순서와 무관하다")
  void loopWarning_independentOfNodeOrder() {
    String ping =
        "  ping:\n    type: human_task\n    role: owner\n    outcomes:\n"
            + "      next: { to: pong }\n      done: { to: end }\n";
    String pong =
        "  pong:\n    type: human_task\n    role: owner\n    outcomes:\n      back: { to: ping }\n";
    String start = "start:\n  - { when: { assigneeRole: owner }, to: ping }\n";

    List<WorkflowProblem> forward =
        validate(wf(ROLES_OWNER, START_NODE + ping + pong + END_NODE, start));
    List<WorkflowProblem> reversed =
        validate(wf(ROLES_OWNER, END_NODE + pong + ping + START_NODE, start));

    assertThat(with(forward, "LOOP_WITHOUT_MAX_VISITS")).hasSize(1);
    assertThat(with(reversed, "LOOP_WITHOUT_MAX_VISITS")).hasSize(1);
    assertThat(with(reversed, "LOOP_WITHOUT_MAX_VISITS").get(0).nodeKey()).isEqualTo("pong");
  }

  @Test
  @DisplayName("username 은 대소문자를 가리지 않는다(구성원 조회·역할 겹침)")
  void memberUsername_caseInsensitive() {
    ProjectMembers pm =
        ProjectMembers.of(List.of(new ProjectMembers.Member("Owner@Example.com", "USER", null)));
    assertThat(pm.find("OWNER@example.COM")).isPresent();
    assertThat(pm.find("other@example.com")).isEmpty();

    String yaml =
        wf(
            ROLES_OWNER + "  twin: { members: [OWNER@EXAMPLE.COM] }\n",
            START_NODE
                + "  work:\n    type: human_task\n    role: owner\n    outcomes:\n"
                + "      done: { to: end }\n      hand: { to: twin_task, assignTo: owner }\n"
                + "  twin_task: { type: human_task, role: twin, outcomes: { done: { to: end } } }\n"
                + END_NODE,
            START_TO_WORK);

    List<WorkflowProblem> ps = validate(yaml, pm);

    assertThat(with(ps, "ROLE_MEMBER_NOT_IN_PROJECT")).isEmpty();
    assertThat(with(ps, "ASSIGNEE_OUTSIDE_TARGET_ROLE")).isEmpty();
  }

  @Test
  @DisplayName("returnTo 로 질문 노드에서 돌아오는 선은 되돌림 고리로 세지 않는다")
  void returnPathVisit_notALoop() {
    String dev =
        "  dev:\n    type: agent_task\n    role: owner\n    outcomes:\n"
            + "      done: { to: end }\n      ask: { to: dev_ask }\n";
    String start = "start:\n  - { when: { assigneeRole: owner }, to: dev }\n";
    String returning =
        "  dev_ask:\n    type: human_task\n    role: owner\n    returnTo: dev\n"
            + "    outcomes:\n      answered: { to: dev }\n";
    String plain =
        "  dev_ask:\n    type: human_task\n    role: owner\n    outcomes:\n"
            + "      answered: { to: dev }\n";

    List<WorkflowProblem> ps =
        validate(wf(ROLES_OWNER, START_NODE + dev + returning + END_NODE, start));
    assertThat(with(ps, "LOOP_WITHOUT_MAX_VISITS")).isEmpty();

    List<WorkflowProblem> noReturn =
        validate(wf(ROLES_OWNER, START_NODE + dev + plain + END_NODE, start));
    assertThat(with(noReturn, "LOOP_WITHOUT_MAX_VISITS")).hasSize(1);
  }

  @Test
  @DisplayName("ask 줄임이 없는 역할을 가리키면 같은 줄·같은 역할은 문제 하나, 위치표가 비면 노드별로 따로")
  void askShorthandUnknownRole_reportedOnce() {
    String yaml =
        wf(
            ROLES_OWNER,
            START_NODE
                + "  dev:\n    type: agent_task\n    role: owner\n    ask: { role: ghost }\n"
                + "    outcomes: { done: { to: end } }\n"
                + END_NODE,
            "start:\n  - { when: { assigneeRole: owner }, to: dev }\n");

    List<WorkflowProblem> ps = validate(yaml);
    assertThat(with(ps, "REF_ROLE_UNKNOWN")).hasSize(1);
    expect(ps, "REF_ROLE_UNKNOWN", "ERROR", "dev", lineOf(yaml, "ask: { role: ghost }"));

    ParseResult r = WorkflowYamlParser.parse(yaml);
    List<WorkflowProblem> blind =
        WorkflowValidator.validate(r.model(), everyone(r.model()), SourceMap.empty());
    assertThat(with(blind, "REF_ROLE_UNKNOWN"))
        .extracting(WorkflowProblem::nodeKey)
        .containsExactlyInAnyOrder("dev", "dev_ask");
  }

  @Test
  @DisplayName("경고가 100건을 넘어도 ERROR 는 남고, 같은 심각도는 100건에서 멈춘다")
  void problemCaps_keepErrorsAmongManyWarnings() {
    StringBuilder roles = new StringBuilder(ROLES_OWNER);
    for (int i = 0; i < 150; i++) {
      roles
          .append("  spare")
          .append(i)
          .append(": { members: [s")
          .append(i)
          .append("@example.com] }\n");
    }
    String yaml =
        wf(
            roles.toString() + "shared:\n  base: hello\n",
            START_NODE
                + "  work: { type: human_task, role: owner, use: [missing], outcomes: { done: { to: end } } }\n"
                + END_NODE,
            START_TO_WORK);

    List<WorkflowProblem> ps = validate(yaml);

    assertThat(ps.stream().filter(p -> p.severity().equals("ERROR"))).hasSize(1);
    assertThat(ps.stream().filter(p -> p.severity().equals("WARNING"))).hasSize(100);

    StringBuilder uses = new StringBuilder();
    for (int i = 0; i < 130; i++) {
      uses.append("m").append(i).append(i < 129 ? ", " : "");
    }
    String many =
        wf(
            ROLES_OWNER,
            START_NODE
                + "  work: { type: human_task, role: owner, use: ["
                + uses
                + "], outcomes: { done: { to: end } } }\n"
                + END_NODE,
            START_TO_WORK);
    assertThat(validate(many).stream().filter(p -> p.severity().equals("ERROR"))).hasSize(100);
  }

  @Test
  @DisplayName("문구에 되비추는 글은 80자, 문구는 500자, nodeKey 는 100자 안이다")
  void echoedTextIsBounded() {
    String longName = "g".repeat(400);
    String yaml =
        wf(
            ROLES_OWNER,
            START_NODE
                + "  work: { type: human_task, role: owner, outcomes: { done: { to: "
                + longName
                + " } } }\n"
                + END_NODE,
            START_TO_WORK);

    List<WorkflowProblem> ps = validate(yaml);

    WorkflowProblem p = with(ps, "REF_NODE_UNKNOWN").get(0);
    assertThat(p.message().length()).isLessThanOrEqualTo(500);
    assertThat(p.message()).doesNotContain("g".repeat(81)).contains("…");

    LinkedHashMap<String, WorkflowModel.Node> nodes = new LinkedHashMap<>();
    String longKey = "k".repeat(300);
    nodes.put(longKey, hand(longKey, "wait", null, Map.of()));
    WorkflowModel m =
        new WorkflowModel("genia/workflow@1", "t", Map.of(), Map.of(), nodes, List.of(), Map.of());
    WorkflowProblem reserved =
        with(WorkflowValidator.validate(m, ProjectMembers.of(List.of())), "NODE_TYPE_RESERVED")
            .get(0);
    assertThat(reserved.nodeKey().length()).isLessThanOrEqualTo(100);
    assertThat(reserved.message().length()).isLessThanOrEqualTo(500);
  }

  @Test
  @DisplayName("노드 수만 개의 긴 사슬도 스택 없이 끝나고 고리 경고 하나를 낸다")
  void longChain_completesWithoutStackOverflow() {
    int count = 20_000;
    LinkedHashMap<String, WorkflowModel.Node> nodes = new LinkedHashMap<>();
    nodes.put("start", hand("start", "start", null, Map.of()));
    for (int i = 0; i < count; i++) {
      String next = i == count - 1 ? "end" : "n" + (i + 1);
      Map<String, WorkflowModel.Outcome> outcomes = new LinkedHashMap<>();
      outcomes.put("next", new WorkflowModel.Outcome("next", next, null, false));
      if (i == count - 1) {
        outcomes.put("again", new WorkflowModel.Outcome("again", "n0", null, false));
      }
      nodes.put("n" + i, hand("n" + i, "human_task", "owner", outcomes));
    }
    nodes.put("end", hand("end", "end", null, Map.of()));
    WorkflowModel m =
        new WorkflowModel(
            "genia/workflow@1",
            "t",
            Map.of("owner", new WorkflowModel.Role("owner", null, List.of("owner@example.com"))),
            Map.of(),
            nodes,
            List.of(new WorkflowModel.Condition("owner", null, null, "n0")),
            Map.of());

    List<WorkflowProblem> ps = WorkflowValidator.validate(m, everyone(m));

    assertThat(ps).noneMatch(p -> p.severity().equals("ERROR"));
    assertThat(with(ps, "LOOP_WITHOUT_MAX_VISITS")).hasSize(1);
    assertThat(with(ps, "LOOP_WITHOUT_MAX_VISITS").get(0).nodeKey()).isEqualTo("n0");
  }

  @Test
  @DisplayName("start 노드가 둘이면 start 목록은 선으로 넣지 않는다: 목록 때문의 AUTO_LOOP·막다름이 없다")
  void twoStarts_listIsNotAGraphEdge() {
    String yaml =
        wf(
            ROLES_OWNER,
            START_NODE + "  start2: { type: start }\n" + WORK + END_NODE,
            "start:\n  - { when: { assigneeRole: owner }, to: start }\n"
                + "  - { when: { assigneeRole: owner }, to: work }\n");

    List<WorkflowProblem> ps = validate(yaml);

    assertThat(with(ps, "START_COUNT")).hasSize(1);
    assertThat(with(ps, "START_INCOMING")).hasSize(1);
    assertThat(with(ps, "AUTO_LOOP")).isEmpty();
    assertThat(with(ps, "NODE_DEAD_END")).isEmpty();
  }

  /** 담당 역할이 비어 있는 이동 문서(assignTo 가 가리키는 nobody 는 어느 노드의 role 도 아니다). */
  private static String emptyAssignRoleDoc(String workExtra, String startList) {
    return wf(
        ROLES_OWNER + "  nobody: { members: [] }\n",
        START_NODE
            + "  w:\n    type: human_task\n    role: owner\n"
            + workExtra
            + "  w2: { type: human_task, role: owner, outcomes: { done: { to: end } } }\n"
            + END_NODE,
        startList);
  }

  @Test
  @DisplayName("구성원 없는 역할로 보내는 이동은 ASSIGNEE_OUTSIDE_TARGET_ROLE(outcome·onError·start)")
  void emptyAssignRole_isRejectedMove() {
    String toW = "start:\n  - { when: { assigneeRole: owner }, to: w }\n";

    String outcome =
        emptyAssignRoleDoc(
            "    outcomes:\n      next:\n        to: w2\n        assignTo: nobody\n", toW);
    expect(
        validate(outcome),
        "ASSIGNEE_OUTSIDE_TARGET_ROLE",
        "ERROR",
        "w",
        lineOf(outcome, "assignTo: nobody"));

    String onError =
        emptyAssignRoleDoc(
            "    onError:\n      to: w2\n      assignTo: nobody\n"
                + "    outcomes: { done: { to: end } }\n",
            toW);
    expect(
        validate(onError),
        "ASSIGNEE_OUTSIDE_TARGET_ROLE",
        "ERROR",
        "w",
        lineOf(onError, "assignTo: nobody"));

    String start =
        emptyAssignRoleDoc(
            "    outcomes: { done: { to: end } }\n",
            "start:\n  - { when: { assigneeRole: nobody }, to: w }\n");
    expect(
        validate(start),
        "ASSIGNEE_OUTSIDE_TARGET_ROLE",
        "ERROR",
        null,
        lineOf(start, "assigneeRole: nobody"));
  }

  @Test
  @DisplayName("보내는 역할이 비었고 어느 노드의 role 이기도 하면 ROLE_EMPTY 가 말하므로 겹침은 따로 내지 않는다(노드 순서 무관)")
  void emptyAssignRoleUsedAsNodeRole_leftToRoleEmpty() {
    String yaml =
        wf(
            ROLES_OWNER + "  nobody: { members: [] }\n",
            START_NODE
                + "  w:\n    type: human_task\n    role: owner\n    outcomes:\n"
                + "      next: { to: w2, assignTo: nobody }\n"
                + "  w2: { type: human_task, role: owner, outcomes: { done: { to: end } } }\n"
                + "  late: { type: human_task, role: nobody, outcomes: { done: { to: end } } }\n"
                + END_NODE,
            START_TO_WORK.replace("to: work", "to: w"));

    List<WorkflowProblem> ps = validate(yaml);

    assertThat(with(ps, "ROLE_EMPTY")).hasSize(1);
    assertThat(with(ps, "ASSIGNEE_OUTSIDE_TARGET_ROLE")).isEmpty();
  }

  @Test
  @DisplayName("경고가 100건을 넘은 뒤 구조 검사에서 나오는 ERROR 도 남는다")
  void problemCaps_keepErrorFoundAfterWarnings() {
    StringBuilder roles = new StringBuilder(ROLES_OWNER);
    for (int i = 0; i < 150; i++) {
      roles
          .append("  spare")
          .append(i)
          .append(": { members: [s")
          .append(i)
          .append("@example.com] }\n");
    }
    String yaml =
        wf(
            roles.toString(),
            START_NODE
                + WORK
                + "  orphan: { type: human_task, role: owner, outcomes: { done: { to: end } } }\n"
                + END_NODE,
            START_TO_WORK);

    List<WorkflowProblem> ps = validate(yaml);

    assertThat(ps.stream().filter(p -> p.severity().equals("WARNING"))).hasSize(100);
    assertThat(with(ps, "NODE_UNREACHABLE")).hasSize(1);
  }

  @Test
  @DisplayName("returnTo 노드의 ask 결과가 다른 노드로 가면 RETURN_TO_WITHOUT_ASK")
  void returnToWithAskPointingElsewhere() {
    String yaml =
        wf(
            ROLES_OWNER,
            START_NODE
                + "  x:\n    type: agent_task\n    role: owner\n    outcomes:\n"
                + "      done: { to: end }\n      ask: { to: other }\n"
                + "  other: { type: human_task, role: owner, outcomes: { done: { to: end } } }\n"
                + "  h:\n    type: human_task\n    role: owner\n    returnTo: x\n"
                + "    outcomes: { done: { to: end } }\n"
                + END_NODE,
            "start:\n  - { when: { assigneeRole: owner }, to: x }\n");

    List<WorkflowProblem> ps = validate(yaml);

    expect(ps, "RETURN_TO_WITHOUT_ASK", "ERROR", "h", lineOf(yaml, "returnTo: x"));
  }

  @Test
  @DisplayName("decision 이 조건만으로, 또는 default 만으로 자기에게 돌아오는 고리도 AUTO_LOOP")
  void autoLoop_throughConditionOnlyOrDefaultOnly() {
    String start = "start:\n  - { when: { assigneeRole: owner }, to: d }\n";
    String viaCondition =
        wf(
            ROLES_OWNER,
            START_NODE
                + "  d:\n    type: decision\n    conditions:\n"
                + "      - { when: { assigneeRole: owner }, to: d }\n    default: end\n"
                + END_NODE,
            start);
    assertThat(with(validate(viaCondition), "AUTO_LOOP")).hasSize(1);

    String viaDefault =
        wf(
            ROLES_OWNER,
            START_NODE
                + "  d:\n    type: decision\n    conditions:\n"
                + "      - { when: { assigneeRole: owner }, to: end }\n    default: d\n"
                + END_NODE,
            start);
    assertThat(with(validate(viaDefault), "AUTO_LOOP")).hasSize(1);
  }

  @Test
  @DisplayName("returnTo 노드의 다른 결과가 만드는 고리는 경고를 잃지 않는다(returnTo 로 가는 선만 뺀다)")
  void returnTo_onlyRemovesTheEdgeToReturnTarget() {
    String yaml =
        wf(
            ROLES_OWNER,
            START_NODE
                + "  dev:\n    type: agent_task\n    role: owner\n    outcomes:\n"
                + "      done: { to: end }\n      ask: { to: q }\n"
                + "  q:\n    type: human_task\n    role: owner\n    returnTo: dev\n    outcomes:\n"
                + "      answered: { to: dev }\n      again: { to: q }\n"
                + END_NODE,
            "start:\n  - { when: { assigneeRole: owner }, to: dev }\n");

    List<WorkflowProblem> ps = validate(yaml);

    assertThat(with(ps, "LOOP_WITHOUT_MAX_VISITS")).hasSize(1);
    assertThat(with(ps, "LOOP_WITHOUT_MAX_VISITS").get(0).nodeKey()).isEqualTo("q");
  }

  @Test
  @DisplayName("사람(USER)은 런타임 값이 INTERNAL 이어도 CAPABILITY_MISSING 을 내지 않는다")
  void requiresCapability_ignoresHumanWithInternalRuntime() {
    String yaml =
        wf(
            "roles:\n  bot: { members: [bot@example.com] }\n",
            START_NODE
                + "  coder:\n    type: agent_task\n    role: bot\n    requires: [local-repo]\n"
                + "    outcomes: { done: { to: end } }\n"
                + END_NODE,
            "start:\n  - { when: { assigneeRole: bot }, to: coder }\n");

    List<WorkflowProblem> ps =
        validate(
            yaml,
            ProjectMembers.of(
                List.of(new ProjectMembers.Member("bot@example.com", "USER", "INTERNAL"))));

    assertThat(with(ps, "CAPABILITY_MISSING")).isEmpty();
  }

  // ───────────────────────── 조건의 context ─────────────────────────

  /** 출력 다섯 개를 가진 plan 뒤의 decision 이 {@code context}·{@code equals} 조건 하나를 보는 정의(다른 문제는 없다). */
  private static String contextDoc(String context, String equals) {
    return wf(
        ROLES_OWNER,
        START_NODE
            + "  plan:\n    type: human_task\n    role: owner\n    outputs:\n"
            + "      doc: { type: url }\n      memo: { type: string }\n"
            + "      count: { type: number }\n      ok: { type: boolean }\n"
            + "      report.final.url: { type: url }\n"
            + "    outcomes: { done: { to: route } }\n"
            + "  route:\n    type: decision\n    conditions:\n"
            + "      - when:\n          context: "
            + context
            + "\n          equals: "
            + equals
            + "\n        to: end\n    default: end\n"
            + END_NODE,
        "start:\n  - { when: { assigneeRole: owner }, to: plan }\n");
  }

  @Test
  @DisplayName("있는 노드의 있는 출력을 가리키는 context 는 문제가 없다(출력 이름의 점 포함)")
  void contextRef_known() {
    assertThat(validate(contextDoc("plan.doc", "x"))).isEmpty();
    assertThat(validate(contextDoc("plan.report.final.url", "x"))).isEmpty();
  }

  @Test
  @DisplayName("없는 노드·없는 출력·점 없음·한쪽이 빈 context 는 그 context 자리에 REF_CONTEXT_UNKNOWN 하나뿐")
  void contextRef_unknown() {
    for (String ref :
        List.of(
            "ghost.doc", // 없는 노드
            "Plan.doc", // 노드 키는 대소문자를 가린다
            "plan.nope", // 없는 출력
            "plan.Doc", // 출력 이름도 대소문자를 가린다
            "route.doc", // 출력이 없는 노드
            "plan.doc.extra", // 첫 점에서만 나눈다
            "plan.report", // 점 든 출력 이름의 앞부분
            "plan.report.final", // 마지막 점에서 나누지 않는다
            "plan", // 점 없음
            "\"\"",
            ".doc", // 노드가 빔
            "plan.", // 출력이 빔
            ".")) {
      // equals 의 형이 무엇이든 못 찾은 참조에는 형 경고를 더하지 않는다.
      String yaml = contextDoc(ref, "5");

      List<WorkflowProblem> ps = validate(yaml);

      assertThat(ps)
          .as("context %s", ref)
          .extracting(WorkflowProblem::code)
          .containsExactly("REF_CONTEXT_UNKNOWN");
      WorkflowProblem p =
          expect(ps, "REF_CONTEXT_UNKNOWN", "ERROR", "route", lineOf(yaml, "context: "));
      assertThat(p.column()).isEqualTo("          ".length() + 1);
      assertThat(p.message()).containsPattern("[가-힣]");
    }
  }

  @Test
  @DisplayName("context 문제는 한 줄에 쓴 조건에서도 그 번째 조건의 키 자리(UTF-16 열)에 건다")
  void contextRef_locatesTheCondition() {
    String good = "      - { when: { context: plan.ok, equals: true }, to: end }\n";
    String typo = "      - { to: end, when: { equals: \"😀\", context: plan.no } }\n";
    String mismatch = "      - { when: { context: plan.ok, equals: 7 }, to: end }\n";
    String yaml =
        wf(
            ROLES_OWNER,
            START_NODE
                + "  plan:\n    type: human_task\n    role: owner\n"
                + "    outputs: { ok: { type: boolean } }\n"
                + "    outcomes: { done: { to: route } }\n"
                + "  route:\n    type: decision\n    conditions:\n"
                + good
                + typo
                + mismatch
                + "    default: end\n"
                + END_NODE,
            "start:\n  - { when: { assigneeRole: owner }, to: plan }\n");

    List<WorkflowProblem> ps = validate(yaml);

    assertThat(ps).hasSize(2);
    WorkflowProblem unknown =
        expect(ps, "REF_CONTEXT_UNKNOWN", "ERROR", "route", lineOf(yaml, "context: plan.no "));
    assertThat(unknown.column()).isEqualTo(typo.indexOf("context:") + 1);
    WorkflowProblem wrongType =
        expect(ps, "CONTEXT_TYPE_MISMATCH", "WARNING", "route", lineOf(yaml, "equals: 7"));
    assertThat(wrongType.column()).isEqualTo(mismatch.indexOf("equals:") + 1);
  }

  @Test
  @DisplayName("equals 의 형이 출력 형과 맞으면 경고하지 않는다(url 모양은 보지 않는다)")
  void contextType_matches() {
    for (List<String> c :
        List.of(
            List.of("doc", "\"https://example.com\""),
            List.of("doc", "주소가 아닌 글"),
            List.of("memo", "\"5\""),
            List.of("memo", "\"true\""),
            List.of("memo", "yes"),
            List.of("memo", "1e400"), // 넘치는 수는 글로 읽힌다
            List.of("memo", "\"\""),
            List.of("count", "5"),
            List.of("count", "-0"),
            List.of("count", "1.5"),
            List.of("count", "1e3"),
            List.of("ok", "true"),
            List.of("ok", "false"))) {
      assertThat(validate(contextDoc("plan." + c.get(0), c.get(1)))).as("%s", c).isEmpty();
    }
  }

  @Test
  @DisplayName("equals 의 형이 출력 형과 맞을 수 없으면 equals 자리에 CONTEXT_TYPE_MISMATCH 경고")
  void contextType_mismatch() {
    for (List<String> c :
        List.of(
            List.of("doc", "5"),
            List.of("doc", "true"),
            List.of("report.final.url", "1.5"),
            List.of("memo", "5"),
            List.of("memo", "1.5"),
            List.of("memo", "false"),
            List.of("count", "\"5\""),
            List.of("count", "\"1.5\""),
            List.of("count", "1e400"),
            List.of("count", "yes"),
            List.of("count", "true"),
            List.of("ok", "\"true\""),
            List.of("ok", "yes"),
            List.of("ok", "1.5"),
            List.of("ok", "1"))) {
      String yaml = contextDoc("plan." + c.get(0), c.get(1));

      List<WorkflowProblem> ps = validate(yaml);

      assertThat(ps)
          .as("%s", c)
          .extracting(WorkflowProblem::code)
          .containsExactly("CONTEXT_TYPE_MISMATCH");
      WorkflowProblem p =
          expect(ps, "CONTEXT_TYPE_MISMATCH", "WARNING", "route", lineOf(yaml, "equals: "));
      assertThat(p.column()).isEqualTo("          ".length() + 1);
    }
  }

  @Test
  @DisplayName("출력 형을 모르면 형 경고를 내지 않는다")
  void contextType_unknownOutputType() {
    for (String type : new String[] {null, "date"}) {
      LinkedHashMap<String, WorkflowModel.Node> nodes = new LinkedHashMap<>();
      nodes.put(
          "plan",
          new WorkflowModel.Node(
              "plan",
              "human_task",
              null,
              null,
              null,
              List.of(),
              List.of(),
              Map.of("v", new WorkflowModel.OutputSpec(type, false)),
              new LinkedHashMap<>(),
              List.of(),
              null,
              null,
              null,
              null,
              null));
      nodes.put(
          "route",
          new WorkflowModel.Node(
              "route",
              "decision",
              null,
              null,
              null,
              List.of(),
              List.of(),
              Map.of(),
              new LinkedHashMap<>(),
              List.of(new WorkflowModel.Condition(null, "plan.v", true, "plan")),
              "plan",
              null,
              null,
              null,
              null));
      WorkflowModel m =
          new WorkflowModel(
              "genia/workflow@1", "t", Map.of(), Map.of(), nodes, List.of(), Map.of());

      List<WorkflowProblem> ps = WorkflowValidator.validate(m, ProjectMembers.of(List.of()));

      assertThat(with(ps, "CONTEXT_TYPE_MISMATCH")).as("%s", type).isEmpty();
      assertThat(with(ps, "REF_CONTEXT_UNKNOWN")).as("%s", type).isEmpty();
    }
  }

  @Test
  @DisplayName("최상위 start 목록의 context 조건은 START_CONTEXT_UNAVAILABLE 하나씩이고 참조·형은 더 보지 않는다")
  void startContext_unavailable() {
    String unknown = "  - { when: { context: ghost.value, equals: 1 }, to: work }\n";
    String known = "  - { when: { context: work.flag, equals: 2 }, to: work }\n";
    String yaml =
        wf(
            ROLES_OWNER,
            START_NODE
                + "  work:\n    type: human_task\n    role: owner\n"
                + "    outputs: { flag: { type: boolean } }\n"
                + "    outcomes: { done: { to: end } }\n"
                + END_NODE,
            START_TO_WORK + unknown + known);

    List<WorkflowProblem> ps = validate(yaml);

    assertThat(ps)
        .extracting(WorkflowProblem::code)
        .containsExactly("START_CONTEXT_UNAVAILABLE", "START_CONTEXT_UNAVAILABLE");
    for (String line : List.of(unknown, known)) {
      WorkflowProblem p =
          expect(
              ps,
              "START_CONTEXT_UNAVAILABLE",
              "ERROR",
              null,
              lineOf(yaml, line.substring(0, line.length() - 1)));
      assertThat(p.column()).isEqualTo(line.indexOf("context:") + 1);
    }
  }

  @Test
  @DisplayName("start 노드 수와 상관없이, context 조건뿐인 start 목록은 게시되지 않는다")
  void startContext_onlyContextConditions() {
    String start = "start:\n  - { when: { context: work.flag, equals: true }, to: work }\n";
    for (String starts : List.of(START_NODE, "")) {
      List<WorkflowProblem> ps = validate(wf(ROLES_OWNER, starts + WORK + END_NODE, start));

      assertThat(with(ps, "START_CONTEXT_UNAVAILABLE")).hasSize(1);
      assertThat(with(ps, "REF_CONTEXT_UNKNOWN")).isEmpty();
      assertThat(with(ps, "START_CONDITIONS_EMPTY")).isEmpty();
    }
  }

  @Test
  @DisplayName("context 문구는 긴 입력을 잘라 되비추고 문제 수는 100건에서 멈춘다")
  void contextProblems_boundedEcho() {
    String longText = "가".repeat(2_000);
    for (String ref : List.of(longText, longText + ".doc", "plan." + longText)) {
      List<WorkflowProblem> ps = validate(contextDoc(ref, "x"));

      assertThat(with(ps, "REF_CONTEXT_UNKNOWN")).hasSize(1);
      assertThat(with(ps, "REF_CONTEXT_UNKNOWN").get(0).message())
          .contains("…")
          .doesNotContain("가".repeat(81))
          .hasSizeLessThanOrEqualTo(500);
    }

    String many = "      - { when: { context: ghost.value, equals: 1 }, to: end }\n".repeat(150);
    String yaml =
        wf(
            ROLES_OWNER,
            START_NODE
                + "  route:\n    type: decision\n    conditions:\n"
                + many
                + "    default: end\n"
                + END_NODE,
            "start:\n  - { when: { assigneeRole: owner }, to: route }\n");
    assertThat(with(validate(yaml), "REF_CONTEXT_UNKNOWN")).hasSize(100);
  }

  // ───────────────────────── 구성원 해석 ─────────────────────────

  /** 사람 구성원 한 명(사람도 실행 방식은 INTERNAL 이다). */
  private static ProjectMembers.Member person(String username) {
    return new ProjectMembers.Member(username, "HUMAN", "INTERNAL");
  }

  /** 역할 a 의 노드가 담당을 a 로 둔 채 역할 b 의 노드로 넘기는 정의(members 는 YAML 목록의 안쪽 글). */
  private static String handOver(String a, String b) {
    return wf(
        "roles:\n  a: { members: [" + a + "] }\n  b: { members: [" + b + "] }\n",
        START_NODE
            + "  work:\n    type: human_task\n    role: a\n    outcomes:\n"
            + "      hand: { to: target, assignTo: a }\n"
            + "  target: { type: human_task, role: b, outcomes: { done: { to: end } } }\n"
            + END_NODE,
        "start:\n  - { when: { assigneeRole: a }, to: work }\n");
  }

  @Test
  @DisplayName("구성원은 정확히 같은 username 이 먼저이고, 없으면 대소문자 무시로 하나일 때만 찾는다")
  void memberFind_exactFirstThenUniqueIgnoreCase() {
    ProjectMembers.Member upper = new ProjectMembers.Member("Kim", "AGENT", "EXTERNAL");
    ProjectMembers.Member lower = person("kim");
    for (List<ProjectMembers.Member> order :
        List.of(List.of(upper, lower), List.of(lower, upper))) {
      ProjectMembers pm = ProjectMembers.of(order);
      assertThat(pm.find("Kim")).contains(upper);
      assertThat(pm.find("kim")).contains(lower);
      assertThat(pm.find("KIM")).as("둘 이상이면 고르지 않는다").isEmpty();
    }

    // 같은 사람이 두 번 실린 것(직접 + 부서)은 모호한 것이 아니다.
    ProjectMembers one = ProjectMembers.of(List.of(upper, upper));
    assertThat(one.find("kIM")).contains(upper);
    assertThat(one.find("kin")).isEmpty();
  }

  @Test
  @DisplayName("대소문자만 다른 구성원이 둘 이상이면 그 줄에 ROLE_MEMBER_AMBIGUOUS 하나뿐, 후보는 싣지 않는다")
  void roleMember_ambiguous() {
    String yaml =
        wf(
            "roles:\n  owner:\n    members:\n      - KIM\n",
            START_NODE + WORK + END_NODE,
            START_TO_WORK);

    List<WorkflowProblem> ps =
        validate(yaml, ProjectMembers.of(List.of(person("Kim"), person("kim"))));

    assertThat(ps).extracting(WorkflowProblem::code).containsExactly("ROLE_MEMBER_AMBIGUOUS");
    WorkflowProblem p = expect(ps, "ROLE_MEMBER_AMBIGUOUS", "ERROR", null, lineOf(yaml, "- KIM"));
    assertThat(p.column()).isEqualTo("      - ".length() + 1);
    assertThat(p.message())
        .contains("정확한 username 으로 적어 주세요")
        .contains("KIM")
        .doesNotContain("Kim")
        .doesNotContain("kim");
  }

  @Test
  @DisplayName("대소문자만 다른 구성원이 있어도 정확히 적으면 문제가 없다")
  void roleMember_exactAmongTwins() {
    ProjectMembers twins = ProjectMembers.of(List.of(person("Kim"), person("kim")));
    for (String typed : List.of("Kim", "kim")) {
      String yaml =
          wf(
              "roles:\n  owner: { members: [" + typed + "] }\n",
              START_NODE + WORK + END_NODE,
              START_TO_WORK);
      assertThat(validate(yaml, twins)).as(typed).isEmpty();
    }
    String both =
        wf(
            "roles:\n  owner: { members: [Kim, kim] }\n",
            START_NODE + WORK + END_NODE,
            START_TO_WORK);
    assertThat(validate(both, twins)).as("서로 다른 두 사람이라 겹친 줄이 아니다").isEmpty();
  }

  @Test
  @DisplayName("한 역할에 같은 사람으로 해석되는 줄이 또 있으면 뒤의 줄마다 ROLE_MEMBER_DUPLICATE 경고")
  void roleMember_duplicate() {
    String yaml =
        wf(
            "roles:\n  owner:\n    members:\n      - Owner@Example.com\n      - other@example.com\n"
                + "      - owner@example.com # 둘째\n      - Owner@Example.com # 셋째\n",
            START_NODE + WORK + END_NODE,
            START_TO_WORK);

    List<WorkflowProblem> ps =
        validate(
            yaml,
            ProjectMembers.of(List.of(person("Owner@Example.com"), person("other@example.com"))));

    assertThat(ps)
        .extracting(WorkflowProblem::code)
        .containsExactly("ROLE_MEMBER_DUPLICATE", "ROLE_MEMBER_DUPLICATE");
    for (String marker : List.of("# 둘째", "# 셋째")) {
      WorkflowProblem p =
          expect(ps, "ROLE_MEMBER_DUPLICATE", "WARNING", null, lineOf(yaml, marker));
      assertThat(p.column()).isEqualTo("      - ".length() + 1);
    }
  }

  @Test
  @DisplayName("다른 역할에 같은 사람이 있거나 못 찾은 이름이 겹치는 것은 겹친 줄 경고가 아니다")
  void roleMember_notDuplicate() {
    assertThat(validate(handOver("kim", "KIM"), ProjectMembers.of(List.of(person("Kim")))))
        .isEmpty();

    List<WorkflowProblem> ps =
        validate(handOver("ghost, GHOST", "ghost"), ProjectMembers.of(List.of()));
    assertThat(ps).extracting(WorkflowProblem::code).containsOnly("ROLE_MEMBER_NOT_IN_PROJECT");
    assertThat(ps).hasSize(3);
  }

  @Test
  @DisplayName("역할 겹침은 해석된 구성원으로 본다 — 대소문자만 다른 두 사람은 겹치지 않는다")
  void roleOverlap_byResolvedMember() {
    String yaml = handOver("Kim", "kim");

    List<WorkflowProblem> twins =
        validate(yaml, ProjectMembers.of(List.of(person("Kim"), person("kim"))));
    assertThat(twins)
        .extracting(WorkflowProblem::code)
        .containsExactly("ASSIGNEE_OUTSIDE_TARGET_ROLE");
    expect(
        twins,
        "ASSIGNEE_OUTSIDE_TARGET_ROLE",
        "ERROR",
        "work",
        lineOf(yaml, "hand: { to: target, assignTo: a }"));

    assertThat(validate(yaml, ProjectMembers.of(List.of(person("KIM")))))
        .as("둘 다 같은 한 사람으로 해석된다")
        .isEmpty();
  }

  @Test
  @DisplayName("해석하지 못한 이름은 소문자로 겹침을 봐서 그 문제 밖의 문제가 늘지 않는다")
  void roleOverlap_unresolvedByLowerCase() {
    ProjectMembers twins =
        ProjectMembers.of(List.of(person("Kim"), person("kim"), person("zoe@example.com")));
    for (List<String> sides :
        List.of(List.of("KIM", "Kim"), List.of("Kim", "KIM"), List.of("KIM", "kIM"))) {
      assertThat(validate(handOver(sides.get(0), sides.get(1)), twins))
          .as("%s", sides)
          .extracting(WorkflowProblem::code)
          .containsOnly("ROLE_MEMBER_AMBIGUOUS");
    }
    assertThat(validate(handOver("GHOST", "ghost"), twins))
        .extracting(WorkflowProblem::code)
        .containsOnly("ROLE_MEMBER_NOT_IN_PROJECT");

    // 누구로 해석되든 겹칠 수 없는 이동은 그대로 말한다.
    assertThat(validate(handOver("KIM", "zoe@example.com"), twins))
        .extracting(WorkflowProblem::code)
        .contains("ROLE_MEMBER_AMBIGUOUS", "ASSIGNEE_OUTSIDE_TARGET_ROLE");
  }

  @Test
  @DisplayName("내부 AI 판정은 해석된 구성원으로 한다")
  void internalAi_byResolvedMember() {
    ProjectMembers.Member ai = new ProjectMembers.Member("Bot", "AGENT", "INTERNAL");
    ProjectMembers.Member human = person("bot");
    for (List<ProjectMembers.Member> order : List.of(List.of(ai, human), List.of(human, ai))) {
      ProjectMembers pm = ProjectMembers.of(order);
      for (String typed : List.of("Bot", "bot", "BOT")) {
        String yaml =
            wf(
                "roles:\n  owner: { members: [" + typed + "] }\n",
                START_NODE
                    + "  work:\n    type: agent_task\n    role: owner\n    requires: [local-repo]\n"
                    + "    outcomes: { done: { to: end } }\n"
                    + END_NODE,
                START_TO_WORK);

        assertThat(with(validate(yaml, pm), "CAPABILITY_MISSING"))
            .as("%s %s", order, typed)
            .hasSize(typed.equals("Bot") ? 1 : 0);
      }
    }
  }

  @Test
  @DisplayName("게시 모델은 구성원만 저장된 username 으로 바뀌고 처음 자리 순서·나머지는 그대로다")
  void withStoredUsernames_replacesOnlyMembers() {
    String yaml =
        wf(
            "roles:\n  owner: { name: 확인자, members: [ZED, amy, zed, Zed, Amy] }\n"
                + "  idle: { members: [] }\n  pair: { members: [kim, Kim] }\n",
            START_NODE + WORK + END_NODE,
            START_TO_WORK + "layout: { work: { x: 1, y: 2 } }\n");
    WorkflowModel typed = WorkflowYamlParser.parse(yaml).model();

    WorkflowModel stored =
        typed.withStoredUsernames(
            ProjectMembers.of(List.of(person("Zed"), person("Amy"), person("Kim"), person("kim"))));

    assertThat(stored.roles().keySet()).containsExactly("owner", "idle", "pair");
    assertThat(stored.roles().get("owner").name()).isEqualTo("확인자");
    assertThat(stored.roles().get("owner").memberUsernames()).containsExactly("Zed", "Amy");
    assertThat(stored.roles().get("idle").memberUsernames()).isEmpty();
    assertThat(stored.roles().get("pair").memberUsernames()).containsExactly("kim", "Kim");
    assertThat(stored.nodes()).isEqualTo(typed.nodes());
    assertThat(stored.nodes().keySet()).containsExactly("start", "work", "end");
    assertThat(stored.start()).isEqualTo(typed.start());
    assertThat(stored.layout()).isEqualTo(typed.layout());
    assertThat(stored.shared()).isEqualTo(typed.shared());
    assertThat(stored.schema()).isEqualTo(typed.schema());
    assertThat(stored.name()).isEqualTo(typed.name());
    assertThat(typed.roles().get("owner").memberUsernames())
        .as("받은 모델은 바꾸지 않는다")
        .containsExactly("ZED", "amy", "zed", "Zed", "Amy");
  }

  @Test
  @DisplayName("해석되지 않은 구성원이 있는 모델은 게시 모델로 바꾸지 않는다(조용히 남기거나 빼지 않는다)")
  void withStoredUsernames_rejectsUnresolved() {
    for (String name : List.of("ghost", "KIM")) {
      WorkflowModel typed =
          WorkflowYamlParser.parse(
                  wf(
                      "roles:\n  owner: { members: [" + name + "] }\n",
                      START_NODE + WORK + END_NODE,
                      START_TO_WORK))
              .model();
      ProjectMembers twins = ProjectMembers.of(List.of(person("Kim"), person("kim")));

      assertThatThrownBy(() -> typed.withStoredUsernames(twins))
          .isInstanceOf(IllegalStateException.class);
    }
  }

  @Test
  @DisplayName("빈 역할이 시작 조건이거나 task 아닌 곳으로 넘기는 담당이면 ROLE_EMPTY(그 흐름은 시작·이동할 수 없다)")
  void emptyRole_towardNonTask() {
    String roles = ROLES_OWNER + "  nobody: { members: [] }\n";
    String route = "  route: { type: decision, default: work }\n";

    String start =
        wf(
            roles,
            START_NODE + route + WORK + END_NODE,
            "start:\n  - { when: { assigneeRole: nobody }, to: route }\n");
    expect(validate(start), "ROLE_EMPTY", "ERROR", null, lineOf(start, "  nobody:"));

    String outcome =
        wf(
            roles,
            START_NODE
                + "  work: { type: human_task, role: owner, outcomes: { done: { to: end, assignTo: nobody } } }\n"
                + END_NODE,
            START_TO_WORK);
    expect(validate(outcome), "ROLE_EMPTY", "ERROR", "work", lineOf(outcome, "  nobody:"));

    String onError =
        wf(
            roles,
            START_NODE
                + "  work:\n    type: agent_task\n    role: owner\n"
                + "    onError: { to: end, assignTo: nobody }\n"
                + "    outcomes: { done: { to: end } }\n"
                + END_NODE,
            START_TO_WORK);
    expect(validate(onError), "ROLE_EMPTY", "ERROR", "work", lineOf(onError, "  nobody:"));
  }

  @Test
  @DisplayName("자기 자신으로의 returnTo 는 복귀 선이 아니라 되돌림 고리로 경고한다")
  void selfReturnTo_isALoop() {
    String yaml =
        wf(
            ROLES_OWNER,
            START_NODE
                + "  work: { type: human_task, role: owner, returnTo: work,"
                + " outcomes: { done: { to: end }, ask: { to: work } } }\n"
                + END_NODE,
            START_TO_WORK);

    assertThat(with(validate(yaml), "LOOP_WITHOUT_MAX_VISITS")).hasSize(1);
  }
}
