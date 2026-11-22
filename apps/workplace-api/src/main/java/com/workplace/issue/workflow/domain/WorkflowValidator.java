package com.workplace.issue.workflow.domain;

import com.workplace.issue.workflow.dto.WorkflowProblem;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.function.Supplier;
import tools.jackson.databind.JsonNode;

/**
 * 워크플로우 정의 정적 검증기(설계 §6). 모델과 프로젝트 구성원, 위치표를 받아 문제 목록을 줄·열·code 순으로 돌려준다.
 *
 * <p>왜: 파서는 문법·형태만 잡고, 종류·참조·구조·구성원 규칙은 여기서 본다. 게시는 ERROR 가 하나라도 있으면 거절되므로 ERROR 는 절대 빠지면 안 된다 —
 * 그래서 ERROR·WARNING 을 따로 100건씩 센다. 순수 계산이다(DB·YAML·로그 없음). 키·값·username 은 모두 믿을 수 없는 입력이라 문구에 되비출 때
 * 80자로 자른다. 모델은 형태만 보장되므로 type·참조·종류별 필수 필드는 null 일 수 있다고 보고 널 안전하게 읽는다. 그래프 계산은 {@link
 * WorkflowGraph} 에 맡긴다.
 */
public final class WorkflowValidator {

  /** 알려진 능력은 하나뿐이다. 다른 값은 오타일 수 있어 경고한다. */
  private static final String CAP_LOCAL_REPO = "local-repo";

  /** 아직 지원하지 않는 예약 종류. */
  private static final Set<String> RESERVED_TYPES = Set.of("wait", "fork", "join");

  /** 노드 필드 검사 순서 — 스키마에 필드를 더하면 이 검사에도 바로 들어오게 스키마에서 읽는다. */
  private static final List<String> NODE_FIELDS = WorkflowSchema.nodeFields();

  /** 종류별 허용 필드(스키마 x-nodeTypes 가 단일 원본). */
  private static final Map<String, Set<String>> ALLOWED = loadAllowed();

  /** 노드 종류 분류. */
  private enum Kind {
    START,
    END,
    DECISION,
    AGENT,
    HUMAN,
    RESERVED,
    UNKNOWN;

    /** 사용자가 아직 지원하지 않거나 모르는 종류(종류 문제만 낸다). */
    boolean untyped() {
      return this == RESERVED || this == UNKNOWN;
    }

    /** agent_task·human_task 인지. */
    boolean task() {
      return this == AGENT || this == HUMAN;
    }

    /** 사람 개입 없이 자동으로 넘어가는 노드(start·decision). */
    boolean auto() {
      return this == START || this == DECISION;
    }
  }

  /** 선의 출처. */
  private enum EdgeKind {
    START_LIST,
    OUTCOME,
    CONDITION,
    DEFAULT,
    ON_ERROR
  }

  /**
   * 적힌 선 하나(없는 노드로 가는 것도 포함).
   *
   * @param from 출발 노드 번호(최상위 start 목록은 -1)
   * @param to 도착 노드 키(null 이면 비어 있음)
   * @param toIdx 도착 노드 번호(없는 노드는 -1)
   * @param path 도착 키 자리의 위치 경로
   * @param nodeKey 문제에 붙일 노드 키(최상위 start 는 null)
   */
  private record Edge(
      int from, String to, int toIdx, EdgeKind kind, List<String> path, String nodeKey) {}

  private final WorkflowModel model;
  private final ProjectMembers members;
  private final SourceMap src;

  private final List<String> keys;
  private final List<WorkflowModel.Node> nodes;
  private final Map<String, Integer> index = new HashMap<>();
  private final Kind[] kinds;
  private final List<Edge> edges = new ArrayList<>();
  private final int[] written;
  private final boolean[] noExitReported;

  /** 노드·결과·조건·start 가 가리킨 역할 키(쓰이지 않는 역할 판정용). */
  private final Set<String> usedRoles = new HashSet<>();

  /** 어느 노드의 role 로든 쓰인 역할 키(ROLE_EMPTY 가 나는 조건과 같은 집합 — 노드 순서와 무관하게 먼저 모은다). */
  private final Set<String> nodeRoles = new HashSet<>();

  /**
   * task 아닌 곳(decision·end)으로 가는 시작 조건·담당 바꾸기에 쓰인 빈 역할 → 처음 쓴 노드 키(start 목록은 null). 겹침 검사는 task 로
   * 가는 선만 보므로 따로 모아 ROLE_EMPTY 로 낸다.
   */
  private final Map<String, String> emptyMoveRoles = new HashMap<>();

  private final Map<String, RoleMembers> roleMembers = new HashMap<>();
  private final Map<String, Boolean> overlapMemo = new HashMap<>();
  private final Map<String, Boolean> internalAiMemo = new HashMap<>();
  private final Set<String> seenRoleRefs = new HashSet<>();

  private final List<WorkflowProblem> out = new ArrayList<>();
  private int errorCount;
  private int warningCount;

  /** 검증 한 번의 상태를 만든다. 구성원·위치표가 없으면 빈 값으로 둬 규칙마다 null 을 보지 않게 한다. */
  private WorkflowValidator(WorkflowModel model, ProjectMembers members, SourceMap src) {
    this.model = model;
    this.members = members == null ? ProjectMembers.of(List.of()) : members;
    this.src = src == null ? SourceMap.empty() : src;
    this.keys = new ArrayList<>(model.nodes().keySet());
    this.nodes = new ArrayList<>(model.nodes().values());
    this.kinds = new Kind[keys.size()];
    this.written = new int[keys.size()];
    this.noExitReported = new boolean[keys.size()];
  }

  /** 위치표 없이 검증한다(모든 위치가 1행 1열). */
  public static List<WorkflowProblem> validate(WorkflowModel m, ProjectMembers members) {
    return validate(m, members, SourceMap.empty());
  }

  /** 위치표로 줄·열을 채워 검증한다. 결과는 줄·열·code 순(같으면 발견 순서). */
  public static List<WorkflowProblem> validate(
      WorkflowModel m, ProjectMembers members, SourceMap source) {
    return new WorkflowValidator(m, members, source).run();
  }

  // ───────────────────────── 진행 ─────────────────────────

  /** 검사를 차례로 돌린다. 쓰인 역할·선을 먼저 모아야 뒤 검사가 쓸 수 있고, 응답은 편집기에서 읽는 순서(줄·열)로 낸다. */
  private List<WorkflowProblem> run() {
    for (int i = 0; i < keys.size(); i++) {
      index.put(keys.get(i), i);
      kinds[i] = kindOf(nodes.get(i).type());
      if (nodes.get(i).roleKey() != null) {
        nodeRoles.add(nodes.get(i).roleKey());
      }
    }
    collectEdges();
    for (int i = 0; i < keys.size(); i++) {
      checkNode(i);
    }
    checkEdges();
    checkRoles();
    checkStructure();
    out.sort(
        Comparator.comparingInt(WorkflowProblem::line)
            .thenComparingInt(WorkflowProblem::column)
            .thenComparing(WorkflowProblem::code));
    return out;
  }

  /** type 글을 종류로 분류한다(null·모르는 글은 UNKNOWN). */
  private static Kind kindOf(String type) {
    if (type == null) {
      return Kind.UNKNOWN;
    }
    return switch (type) {
      case "start" -> Kind.START;
      case "end" -> Kind.END;
      case "decision" -> Kind.DECISION;
      case "agent_task" -> Kind.AGENT;
      case "human_task" -> Kind.HUMAN;
      default -> RESERVED_TYPES.contains(type) ? Kind.RESERVED : Kind.UNKNOWN;
    };
  }

  /** 스키마 x-nodeTypes 를 종류 → 허용 필드 집합으로 읽는다. */
  private static Map<String, Set<String>> loadAllowed() {
    Map<String, Set<String>> map = new HashMap<>();
    JsonNode types = WorkflowSchema.nodeTypes();
    for (var e : types.properties()) {
      Set<String> fields = new HashSet<>();
      e.getValue().forEach(f -> fields.add(f.asString()));
      map.put(e.getKey(), fields);
    }
    return map;
  }

  // ───────────────────────── 문제 담기 ─────────────────────────

  /** 경로의 원문 위치 — 위치표에 없으면 가까운 부모라 문제마다 줄이 있다. */
  private SourceMap.Pos at(List<String> path) {
    return src.at(path);
  }

  /** 위치 경로를 만든다 — 키에 점이 들 수 있어 글로 잇지 않고 조각 목록으로 다룬다. */
  private static List<String> path(String... segments) {
    return List.of(segments);
  }

  /** 글을 80자까지만 되비춘다(없으면 「(없음)」). */
  private static String q(String text) {
    return text == null ? "(없음)" : "'" + ParseSession.clip(text) + "'";
  }

  /** 게시를 막는 문제를 담는다. */
  private void error(String code, Supplier<String> message, List<String> path, String nodeKey) {
    add(WorkflowProblem.ERROR, code, message, path, nodeKey);
  }

  /** 게시는 되지만 알려 줄 문제를 담는다. */
  private void warning(String code, Supplier<String> message, List<String> path, String nodeKey) {
    add(WorkflowProblem.WARNING, code, message, path, nodeKey);
  }

  /** 심각도별 상한(100건)에서 멈춘다 — 경고가 많아도 ERROR 는 빠지지 않는다. 문구는 담을 때만 만든다. */
  private void add(
      String severity, String code, Supplier<String> message, List<String> path, String nodeKey) {
    boolean isError = WorkflowProblem.ERROR.equals(severity);
    if ((isError ? errorCount : warningCount) >= ParseSession.MAX_PROBLEMS) {
      return;
    }
    SourceMap.Pos pos = at(path);
    out.add(
        new WorkflowProblem(
            severity,
            code,
            ParseSession.limitMessage(message.get()),
            pos.line(),
            pos.column(),
            ParseSession.limitNodeKey(nodeKey)));
    if (isError) {
      errorCount++;
    } else {
      warningCount++;
    }
  }

  // ───────────────────────── 선 모으기 ─────────────────────────

  /** 모든 적힌 선(start 목록·결과·조건·default·onError)을 모은다. 노드별 「적힌 나가는 길」 수도 센다(onError 제외). */
  private void collectEdges() {
    List<WorkflowModel.Condition> start = model.start();
    for (int i = 0; i < start.size(); i++) {
      addEdge(
          -1,
          start.get(i).to(),
          EdgeKind.START_LIST,
          path("start", Integer.toString(i), "to"),
          null);
    }
    for (int i = 0; i < keys.size(); i++) {
      String k = keys.get(i);
      WorkflowModel.Node n = nodes.get(i);
      for (Map.Entry<String, WorkflowModel.Outcome> o : n.outcomes().entrySet()) {
        addEdge(
            i,
            o.getValue().to(),
            EdgeKind.OUTCOME,
            path("nodes", k, "outcomes", o.getKey(), "to"),
            k);
      }
      for (int c = 0; c < n.conditions().size(); c++) {
        addEdge(
            i,
            n.conditions().get(c).to(),
            EdgeKind.CONDITION,
            path("nodes", k, "conditions", Integer.toString(c), "to"),
            k);
      }
      if (n.defaultTo() != null) {
        addEdge(i, n.defaultTo(), EdgeKind.DEFAULT, path("nodes", k, "default"), k);
      }
      if (n.onError() != null) {
        addEdge(i, n.onError().to(), EdgeKind.ON_ERROR, path("nodes", k, "onError", "to"), k);
      }
    }
  }

  /** 선 하나를 담는다. onError 는 사람 조치라 막다름 판정의 「적힌 나가는 길」에 세지 않는다. */
  private void addEdge(int from, String to, EdgeKind kind, List<String> path, String nodeKey) {
    Integer idx = to == null ? null : index.get(to);
    edges.add(new Edge(from, to, idx == null ? -1 : idx, kind, path, nodeKey));
    if (from >= 0 && kind != EdgeKind.ON_ERROR) {
      written[from]++;
    }
  }

  // ───────────────────────── 노드 하나 ─────────────────────────

  /** 노드 하나의 종류·필드·필수·참조(shared·역할·returnTo)·능력·ask 규칙. */
  private void checkNode(int i) {
    String k = keys.get(i);
    WorkflowModel.Node n = nodes.get(i);
    Kind kind = kinds[i];

    if (kind == Kind.RESERVED) {
      error(
          "NODE_TYPE_RESERVED",
          () ->
              "노드 종류 "
                  + q(n.type())
                  + " 은(는) 아직 지원하지 않음 — 지금은 쓸 수 없습니다. start·end·decision·agent_task·human_task 중에서 골라 주세요.",
          path("nodes", k, "type"),
          k);
    } else if (kind == Kind.UNKNOWN) {
      error(
          "NODE_TYPE_UNKNOWN",
          () ->
              n.type() == null
                  ? "노드 종류(type)가 없습니다. start·end·decision·agent_task·human_task 중에서 골라 주세요."
                  : "노드 종류 "
                      + q(n.type())
                      + " 을(를) 알 수 없습니다. start·end·decision·agent_task·human_task 중에서 골라 주세요.",
          path("nodes", k, "type"),
          k);
    } else {
      checkFieldsAllowed(k, n);
      checkRequired(i, k, n);
    }

    for (int u = 0; u < n.use().size(); u++) {
      String name = n.use().get(u);
      if (name == null || !model.shared().containsKey(name)) {
        error(
            "REF_SHARED_UNKNOWN",
            () -> "use 에 적은 공용 지시 " + q(name) + " 이(가) shared 에 없습니다.",
            path("nodes", k, "use", Integer.toString(u)),
            k);
      }
    }

    if (n.roleKey() != null) {
      refRole(n.roleKey(), path("nodes", k, "role"), k);
    }
    for (Map.Entry<String, WorkflowModel.Outcome> o : n.outcomes().entrySet()) {
      checkAssign(
          o.getValue().assignTo(),
          o.getValue().to(),
          path("nodes", k, "outcomes", o.getKey(), "assignTo"),
          k);
    }
    if (n.onError() != null) {
      checkAssign(
          n.onError().assignTo(), n.onError().to(), path("nodes", k, "onError", "assignTo"), k);
    }
    for (int c = 0; c < n.conditions().size(); c++) {
      WorkflowModel.Condition condition = n.conditions().get(c);
      String at = Integer.toString(c);
      if (condition.assigneeRole() != null) {
        refRole(
            condition.assigneeRole(),
            path("nodes", k, "conditions", at, "when", "assigneeRole"),
            k);
      } else if (kind == Kind.DECISION) {
        checkContext(k, at, condition);
      }
    }

    if (n.returnTo() != null) {
      checkReturnTo(i, k, n);
    }
    if (kind == Kind.AGENT) {
      checkRequires(k, n);
      checkAskPath(k, n);
    }
  }

  /** 종류에 없는 필드는 NODE_FIELD_NOT_ALLOWED. 모델에 값이 있거나 원문에 적혀 있으면(ask 는 모델에 없다) 적힌 것으로 본다. */
  private void checkFieldsAllowed(String k, WorkflowModel.Node n) {
    Set<String> allowed = ALLOWED.getOrDefault(n.type(), Set.of());
    for (String field : NODE_FIELDS) {
      if (allowed.contains(field) || !(hasValue(n, field) || src.has(path("nodes", k, field)))) {
        continue;
      }
      error(
          "NODE_FIELD_NOT_ALLOWED",
          () -> q(n.type()) + " 노드에는 '" + field + "' 를 쓸 수 없습니다. 이 필드를 지워 주세요.",
          path("nodes", k, field),
          k);
    }
  }

  /** 모델에 이 필드 값이 들어 있는지. */
  private static boolean hasValue(WorkflowModel.Node n, String field) {
    return switch (field) {
      case "name" -> n.name() != null;
      case "role" -> n.roleKey() != null;
      case "instructions" -> n.instructions() != null;
      case "use" -> !n.use().isEmpty();
      case "requires" -> !n.requires().isEmpty();
      case "outputs" -> !n.outputs().isEmpty();
      case "outcomes" -> !n.outcomes().isEmpty();
      case "conditions" -> !n.conditions().isEmpty();
      case "default" -> n.defaultTo() != null;
      case "maxVisits" -> n.maxVisits() != null;
      case "timeout" -> n.timeout() != null;
      case "onError" -> n.onError() != null;
      case "returnTo" -> n.returnTo() != null;
      default -> false;
    };
  }

  /** 종류별 필수: task 는 role·outcome, decision 은 default. */
  private void checkRequired(int i, String k, WorkflowModel.Node n) {
    Kind kind = kinds[i];
    if (kind.task()) {
      if (n.roleKey() == null) {
        error(
            "TASK_ROLE_MISSING",
            () -> "담당 역할(role)이 없습니다. 이 노드를 맡을 역할을 적어 주세요.",
            path("nodes", k, "role"),
            k);
      }
      if (n.outcomes().isEmpty()) {
        noExitReported[i] = true;
        error(
            "TASK_OUTCOME_MISSING",
            () -> "결과(outcomes)가 하나도 없습니다. 다음으로 갈 길을 적어 주세요.",
            path("nodes", k, "outcomes"),
            k);
      }
    } else if (kind == Kind.DECISION && n.defaultTo() == null) {
      noExitReported[i] = true;
      error(
          "DECISION_DEFAULT_MISSING",
          () -> "맞는 조건이 없을 때 갈 곳(default)이 없습니다.",
          path("nodes", k, "default"),
          k);
    }
  }

  /** 역할 키가 roles 에 있는지(없으면 REF_ROLE_UNKNOWN). 쓰인 역할로 기록한다. ask 줄임이 같은 자리를 여러 번 가리키면 하나만 낸다. */
  private void refRole(String role, List<String> path, String nodeKey) {
    usedRoles.add(role);
    if (model.roles().containsKey(role)) {
      return;
    }
    SourceMap.Pos pos = at(path);
    // 위치를 알면 같은 줄·열·역할을 하나로, 모르면(전부 1행 1열) 노드까지 같아야 같은 문제로 본다.
    String dedupe =
        pos.line() + ":" + pos.column() + ":" + role + (src.has(path) ? "" : ":" + nodeKey);
    if (seenRoleRefs.add(dedupe)) {
      error("REF_ROLE_UNKNOWN", () -> "역할 " + q(role) + " 이(가) roles 에 없습니다.", path, nodeKey);
    }
  }

  /** assignTo 의 역할 참조와, 도착 task 역할과 구성원이 겹치는지. keep·생략은 실행 검증 몫이다. */
  private void checkAssign(String assignTo, String to, List<String> path, String nodeKey) {
    if (assignTo == null || "keep".equals(assignTo)) {
      return;
    }
    refRole(assignTo, path, nodeKey);
    noteEmptyMove(assignTo, to, nodeKey);
    checkOverlap(assignTo, to, path, nodeKey);
  }

  /** 빈 역할로 decision·end 에 가는 이동을 적어 둔다 — 맞거나 맡을 사람이 없어 그 흐름은 시작·이동할 수 없다. */
  private void noteEmptyMove(String role, String to, String nodeKey) {
    Integer idx = to == null ? null : index.get(to);
    WorkflowModel.Role def = model.roles().get(role);
    if (idx == null || def == null || kinds[idx].task() || kinds[idx].untyped()) {
      return;
    }
    if (def.memberUsernames().isEmpty() && !emptyMoveRoles.containsKey(role)) {
      emptyMoveRoles.put(role, nodeKey);
    }
  }

  /** 담당으로 바꿀 역할과 도착 task 노드의 role 이 한 명도 겹치지 않으면 ASSIGNEE_OUTSIDE_TARGET_ROLE. */
  private void checkOverlap(String assignRole, String to, List<String> path, String nodeKey) {
    Integer idx = to == null ? null : index.get(to);
    if (idx == null || !kinds[idx].task()) {
      return;
    }
    String targetRole = nodes.get(idx).roleKey();
    if (targetRole == null
        || !model.roles().containsKey(assignRole)
        || !model.roles().containsKey(targetRole)
        || membersOf(targetRole).isEmpty()
        || (membersOf(assignRole).isEmpty() && nodeRoles.contains(assignRole))
        || !disjoint(assignRole, targetRole)) {
      return;
    }
    error(
        "ASSIGNEE_OUTSIDE_TARGET_ROLE",
        () ->
            "역할 "
                + q(assignRole)
                + " 의 구성원 중 도착 노드 "
                + q(to)
                + " 의 담당 역할 "
                + q(targetRole)
                + " 에 속한 사람이 없어 이 이동은 항상 거절됩니다.",
        path,
        nodeKey);
  }

  /**
   * 두 역할의 구성원이 하나도 겹치지 않는지(한쪽이 비면 겹치지 않는 것이다 — ROLE_EMPTY 가 말하는 때는 호출하는 쪽이 먼저 건너뛴다). 역할 쌍마다 한 번만
   * 계산한다.
   */
  private boolean disjoint(String a, String b) {
    return overlapMemo.computeIfAbsent(
        a + "\u0000" + b, key -> !membersOf(a).overlaps(membersOf(b)));
  }

  /** 역할 구성원을 해석한 것(역할마다 한 번만 계산). */
  private RoleMembers membersOf(String role) {
    return roleMembers.computeIfAbsent(
        role, r -> RoleMembers.of(model.roles().get(r).memberUsernames(), members));
  }

  /**
   * decision 조건의 context({@code <노드>.<출력>})가 있는 출력을 가리키는지, equals 가 그 출력과 맞을 수 있는지. 없는 출력은 실행 때 조용히
   * default 로 빠져 사람 확인을 건너뛸 수 있으므로 ERROR 다. 노드 키에는 점이 없고 출력 이름에는 있을 수 있어 첫 점에서 나눈다. 조건마다 맵 조회 두 번이라
   * 비용은 조건 수에 비례한다.
   */
  private void checkContext(String k, String at, WorkflowModel.Condition condition) {
    List<String> where = path("nodes", k, "conditions", at, "when", "context");
    String ref = condition.contextKey();
    int dot = ref == null ? -1 : ref.indexOf('.');
    if (dot <= 0 || dot == ref.length() - 1) {
      error(
          "REF_CONTEXT_UNKNOWN",
          () -> "context " + q(ref) + " 을(를) 읽을 수 없습니다. <노드>.<출력> 꼴로 적어 주세요.",
          where,
          k);
      return;
    }
    String from = ref.substring(0, dot);
    Integer idx = index.get(from);
    if (idx == null) {
      error(
          "REF_CONTEXT_UNKNOWN",
          () -> "context 에 적은 노드 " + q(from) + " 이(가) nodes 에 없습니다.",
          where,
          k);
      return;
    }
    String output = ref.substring(dot + 1);
    WorkflowModel.OutputSpec spec = nodes.get(idx).outputs().get(output);
    if (spec == null) {
      error(
          "REF_CONTEXT_UNKNOWN",
          () -> "context 에 적은 출력 " + q(output) + " 이(가) 노드 " + q(from) + " 의 outputs 에 없습니다.",
          where,
          k);
    } else if (!canEqual(spec.type(), condition.equalsValue())) {
      warning(
          "CONTEXT_TYPE_MISMATCH",
          () ->
              "equals 값의 형이 출력 "
                  + q(ref)
                  + " 의 형("
                  + spec.type()
                  + ")과 달라 이 조건은 맞을 수 없습니다. "
                  + equalsHint(spec.type()),
          path("nodes", k, "conditions", at, "when", "equals"),
          k);
    }
  }

  /** equals 값이 이 형의 출력과 같을 수 있는지. 형이나 값을 모르면 같을 수 있다고 본다(url 의 모양은 보지 않는다). */
  private static boolean canEqual(String outputType, Object value) {
    if (outputType == null || value == null) {
      return true;
    }
    return switch (outputType) {
      case "string", "url" -> value instanceof String;
      case "number" -> value instanceof Number;
      case "boolean" -> value instanceof Boolean;
      default -> true;
    };
  }

  /** 출력 형에 맞게 equals 를 적는 법(따옴표 하나로 형이 갈리므로 적는 꼴까지 말한다). */
  private static String equalsHint(String outputType) {
    return switch (outputType) {
      case "number" -> "따옴표 없는 수로 적어 주세요.";
      case "boolean" -> "따옴표 없는 true 또는 false 로 적어 주세요.";
      default -> "글로 적어 주세요(수·true·false 처럼 보이는 글은 따옴표로 감쌉니다).";
    };
  }

  /** returnTo 의 노드가 있어야 하고, human_task 라면 그 노드에 이 노드로 오는 ask 결과가 있어야 한다. */
  private void checkReturnTo(int i, String k, WorkflowModel.Node n) {
    Integer idx = index.get(n.returnTo());
    if (idx == null) {
      error(
          "REF_NODE_UNKNOWN",
          () -> "returnTo 에 적은 노드 " + q(n.returnTo()) + " 이(가) 없습니다.",
          path("nodes", k, "returnTo"),
          k);
      return;
    }
    WorkflowModel.Outcome ask = nodes.get(idx).outcomes().get("ask");
    if (kinds[i] == Kind.HUMAN && (ask == null || !k.equals(ask.to()))) {
      error(
          "RETURN_TO_WITHOUT_ASK",
          () -> "returnTo 가 가리킨 노드 " + q(n.returnTo()) + " 에 이 노드로 오는 'ask' 결과가 없습니다.",
          path("nodes", k, "returnTo"),
          k);
    }
  }

  /** requires: local-repo 는 담당 역할에 내부 AI 가 있으면 경고, 다른 값은 모르는 능력 경고. */
  private void checkRequires(String k, WorkflowModel.Node n) {
    for (int r = 0; r < n.requires().size(); r++) {
      String cap = n.requires().get(r);
      List<String> p = path("nodes", k, "requires", Integer.toString(r));
      if (cap == null) {
        continue;
      }
      if (!CAP_LOCAL_REPO.equals(cap)) {
        warning(
            "CAPABILITY_UNKNOWN",
            () -> "알 수 없는 능력 " + q(cap) + " 입니다. 지금 아는 능력은 local-repo 하나입니다. 오타가 아닌지 확인해 주세요.",
            p,
            k);
      } else if (n.roleKey() != null && hasInternalAi(n.roleKey())) {
        warning(
            "CAPABILITY_MISSING",
            () ->
                "local-repo 가 필요한데 담당 역할 "
                    + q(n.roleKey())
                    + " 에 내부 AI 가 있습니다. 내부 AI 는 로컬 저장소를 쓸 수 없습니다.",
            p,
            k);
      }
    }
  }

  /** 역할 구성원 중 내부(INTERNAL) 런타임의 AI 가 있는지(역할마다 한 번만 계산). */
  private boolean hasInternalAi(String role) {
    return internalAiMemo.computeIfAbsent(
        role,
        r -> {
          WorkflowModel.Role def = model.roles().get(r);
          if (def == null) {
            return false;
          }
          for (String u : def.memberUsernames()) {
            ProjectMembers.Member m = members.find(u).orElse(null);
            if (m != null
                && "AGENT".equalsIgnoreCase(m.kind())
                && "INTERNAL".equalsIgnoreCase(m.agentRuntime())) {
              return true;
            }
          }
          return false;
        });
  }

  /** agent_task 가 사람 질문 노드로 가는 ask 결과를 갖는지(없으면 막혔을 때 물을 길이 없다는 경고). */
  private void checkAskPath(String k, WorkflowModel.Node n) {
    WorkflowModel.Outcome ask = n.outcomes().get("ask");
    Integer idx = ask == null || ask.to() == null ? null : index.get(ask.to());
    if (idx == null || kinds[idx] != Kind.HUMAN) {
      warning(
          "ASK_PATH_MISSING",
          () -> "사람에게 물어볼 길이 없습니다. human_task 로 가는 'ask' 결과(또는 ask 줄임)를 더하면 막혔을 때 질문할 수 있습니다.",
          path("nodes", k),
          k);
    }
  }

  // ───────────────────────── 선 참조 ─────────────────────────

  /** 모든 선의 도착 노드가 있는지, start 로 들어오는지. start 목록 조건이 시작 때 알 수 있는 것인지도 본다. */
  private void checkEdges() {
    for (Edge e : edges) {
      if (e.toIdx() < 0) {
        error(
            "REF_NODE_UNKNOWN",
            () ->
                e.to() == null
                    ? "이동할 노드(to)가 비어 있습니다."
                    : "이동할 노드 " + q(e.to()) + " 이(가) nodes 에 없습니다.",
            e.path(),
            e.nodeKey());
      } else if (kinds[e.toIdx()] == Kind.START) {
        error(
            "START_INCOMING",
            () -> "start 노드로 들어오는 연결은 쓸 수 없습니다. start 는 흐름의 처음에만 있습니다.",
            e.path(),
            e.nodeKey());
      }
    }
    List<WorkflowModel.Condition> start = model.start();
    for (int i = 0; i < start.size(); i++) {
      String role = start.get(i).assigneeRole();
      if (role != null) {
        List<String> p = path("start", Integer.toString(i), "when", "assigneeRole");
        refRole(role, p, null);
        noteEmptyMove(role, start.get(i).to(), null);
        checkOverlap(role, start.get(i).to(), p, null);
      } else {
        // 실행을 시작할 때는 문맥이 비어 있다 — 같은 원인이라 참조·형 문제는 더 내지 않는다.
        error(
            "START_CONTEXT_UNAVAILABLE",
            () -> "start 조건에는 context 를 쓸 수 없습니다. 시작할 때는 아직 나온 값이 없으니 assigneeRole 로 적어 주세요.",
            path("start", Integer.toString(i), "when", "context"),
            null);
      }
    }
  }

  // ───────────────────────── 역할 ─────────────────────────

  /** 구성원의 해석(소속·모호·겹친 줄), 노드·시작 조건·담당 바꾸기가 쓰는 빈 역할, 쓰이지 않는 역할. */
  private void checkRoles() {
    Map<String, String> firstUser = new HashMap<>();
    for (int i = 0; i < keys.size(); i++) {
      String role = nodes.get(i).roleKey();
      if (role != null) {
        firstUser.putIfAbsent(role, keys.get(i));
      }
    }
    for (Map.Entry<String, WorkflowModel.Role> e : model.roles().entrySet()) {
      String roleKey = e.getKey();
      List<String> usernames = e.getValue().memberUsernames();
      Set<String> listed = new HashSet<>();
      for (int m = 0; m < usernames.size(); m++) {
        checkMember(
            usernames.get(m), listed, path("roles", roleKey, "members", Integer.toString(m)));
      }
      if (usernames.isEmpty() && firstUser.containsKey(roleKey)) {
        error(
            "ROLE_EMPTY",
            () -> "역할 " + q(roleKey) + " 은(는) 노드가 쓰는데 구성원이 한 명도 없습니다.",
            path("roles", roleKey),
            firstUser.get(roleKey));
      } else if (usernames.isEmpty() && emptyMoveRoles.containsKey(roleKey)) {
        error(
            "ROLE_EMPTY",
            () -> "역할 " + q(roleKey) + " 은(는) 시작 조건이나 담당 바꾸기(assignTo)에 쓰는데 구성원이 한 명도 없습니다.",
            path("roles", roleKey),
            emptyMoveRoles.get(roleKey));
      }
      if (!usedRoles.contains(roleKey)) {
        warning(
            "ROLE_UNUSED",
            () -> "역할 " + q(roleKey) + " 은(는) 어디에도 쓰이지 않습니다.",
            path("roles", roleKey),
            null);
      }
    }
  }

  /**
   * members 한 줄이 프로젝트 구성원 한 명으로 정해지는지, 같은 역할의 앞줄과 같은 사람인지. 모호하면 그 문제 하나만 내고, 다른 구성원의 이름(후보)은 되비추지
   * 않는다.
   *
   * @param listed 이 역할에서 앞줄까지 해석된 username
   */
  private void checkMember(String typed, Set<String> listed, List<String> where) {
    ProjectMembers.Member found = members.find(typed).orElse(null);
    if (found != null) {
      if (!listed.add(found.username())) {
        warning(
            "ROLE_MEMBER_DUPLICATE",
            () -> "구성원 " + q(typed) + " 은(는) 이 역할의 앞줄과 같은 사람입니다. 게시하면 한 번만 남으니 이 줄을 지워 주세요.",
            where,
            null);
      }
    } else if (members.isAmbiguous(typed)) {
      error(
          "ROLE_MEMBER_AMBIGUOUS",
          () ->
              "구성원 "
                  + q(typed)
                  + " 은(는) 대소문자만 다른 구성원이 둘 이상이라 누구인지 정할 수 없습니다. 정확한 username 으로 적어 주세요.",
          where,
          null);
    } else {
      error(
          "ROLE_MEMBER_NOT_IN_PROJECT",
          () -> "구성원 " + q(typed) + " 은(는) 이 프로젝트의 활성 구성원이 아닙니다.",
          where,
          null);
    }
  }

  // ───────────────────────── 구조(그래프) ─────────────────────────

  /** start·end 개수, 도달·막다름·고리. */
  private void checkStructure() {
    List<Integer> starts = new ArrayList<>();
    List<Integer> ends = new ArrayList<>();
    for (int i = 0; i < kinds.length; i++) {
      if (kinds[i] == Kind.START) {
        starts.add(i);
      } else if (kinds[i] == Kind.END) {
        ends.add(i);
      }
    }
    if (starts.size() != 1) {
      int extra = starts.size() > 1 ? starts.get(1) : -1;
      error(
          "START_COUNT",
          () -> "start 노드는 정확히 하나여야 합니다(지금 " + starts.size() + "개).",
          extra < 0 ? path("nodes") : path("nodes", keys.get(extra)),
          extra < 0 ? null : keys.get(extra));
    }
    if (model.start().isEmpty()) {
      for (int s : starts) {
        noExitReported[s] = true;
      }
      error(
          "START_CONDITIONS_EMPTY",
          () -> "start 조건 목록이 비어 있습니다. 시작할 길을 하나 이상 적어 주세요.",
          path("start"),
          null);
    }
    if (ends.isEmpty()) {
      error("END_MISSING", () -> "end 노드가 없습니다. 흐름이 끝나는 곳이 필요합니다.", path("nodes"), null);
    }

    WorkflowGraph g = buildGraph(starts);
    if (starts.size() == 1) {
      checkReachable(g, starts.get(0));
    }
    if (!ends.isEmpty()) {
      checkDeadEnds(g, ends, starts.size());
    }
    checkLoops(g);
  }

  /** 없는 노드로 가는 선은 빼고 그래프를 만든다. start 목록은 모든 start 노드에서 나가는 선으로 센다. */
  private WorkflowGraph buildGraph(List<Integer> starts) {
    WorkflowGraph g = new WorkflowGraph(keys.size());
    for (Edge e : edges) {
      if (e.toIdx() < 0) {
        continue;
      }
      if (e.from() < 0) {
        // start 노드가 정확히 하나일 때만 목록이 그 노드의 선이다(0·2개 이상은 START_COUNT 가 말하고 선 수가 폭증하지 않게 한다).
        for (int s : starts.size() == 1 ? starts : List.<Integer>of()) {
          g.edge(s, e.toIdx(), 0);
        }
        continue;
      }
      int flags = 0;
      if (e.kind() == EdgeKind.ON_ERROR) {
        flags |= WorkflowGraph.ON_ERROR;
      } else if (e.kind() == EdgeKind.OUTCOME
          && e.from() != e.toIdx() // 자기 자신으로의 returnTo 는 질문한 곳으로 돌아가는 게 아니라 고리다
          && nodes.get(e.from()).returnTo() != null
          && nodes.get(e.from()).returnTo().equals(e.to())) {
        flags |= WorkflowGraph.RETURN;
      }
      g.edge(e.from(), e.toIdx(), flags);
    }
    return g;
  }

  /** start 에서 (조건·default·결과·onError 로) 닿지 않는 노드. */
  private void checkReachable(WorkflowGraph g, int start) {
    boolean[] reach = g.reachableFrom(start, 0);
    for (int i = 0; i < reach.length; i++) {
      if (!reach[i]) {
        String k = keys.get(i);
        error("NODE_UNREACHABLE", () -> "start 에서 이 노드로 닿는 길이 없습니다.", path("nodes", k), k);
      }
    }
  }

  /** end 까지 (onError 를 뺀 길로) 못 가는 노드. 종류 문제가 난 노드와 길이 없다고 이미 말한 노드는 건너뛴다. */
  private void checkDeadEnds(WorkflowGraph g, List<Integer> ends, int startCount) {
    boolean[] targets = new boolean[keys.size()];
    for (int e : ends) {
      targets[e] = true;
    }
    boolean[] can = g.canReach(targets, WorkflowGraph.ON_ERROR);
    for (int i = 0; i < can.length; i++) {
      if (can[i]
          || kinds[i] == Kind.END
          || kinds[i].untyped()
          || (kinds[i] == Kind.START && startCount != 1)
          || (noExitReported[i] && written[i] == 0)) {
        continue;
      }
      String k = keys.get(i);
      error(
          "NODE_DEAD_END",
          () -> "이 노드에서 end 로 가는 길이 없습니다(onError 는 사람 조치라 세지 않습니다).",
          path("nodes", k),
          k);
    }
  }

  /** 자동 노드끼리 도는 고리(ERROR)와, maxVisits 없이 되돌아가는 고리(WARNING). */
  private void checkLoops(WorkflowGraph g) {
    boolean[] auto = new boolean[keys.size()];
    boolean[] unguarded = new boolean[keys.size()];
    for (int i = 0; i < auto.length; i++) {
      auto[i] = kinds[i].auto();
      unguarded[i] = nodes.get(i).maxVisits() == null;
    }
    for (int[] comp : g.cycles(auto, WorkflowGraph.ON_ERROR)) {
      String k = keys.get(comp[0]);
      error(
          "AUTO_LOOP",
          () -> "start·decision 끼리만 도는 고리입니다. 사람이나 AI 가 끼지 않으면 끝나지 않습니다.",
          path("nodes", k),
          k);
    }
    for (int[] comp : g.cycles(unguarded, WorkflowGraph.ON_ERROR | WorkflowGraph.RETURN)) {
      boolean allAuto = true;
      for (int v : comp) {
        allAuto &= auto[v];
      }
      if (allAuto) {
        continue;
      }
      String k = keys.get(comp[0]);
      warning(
          "LOOP_WITHOUT_MAX_VISITS",
          () -> "되돌아가는 고리에 maxVisits 가 있는 노드가 없어 끝없이 돌 수 있습니다. 고리 안 한 노드에 maxVisits 를 적어 주세요.",
          path("nodes", k),
          k);
    }
  }
}
