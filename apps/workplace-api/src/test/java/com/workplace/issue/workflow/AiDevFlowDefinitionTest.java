package com.workplace.issue.workflow;

import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.issue.workflow.domain.ParseResult;
import com.workplace.issue.workflow.domain.ProjectMembers;
import com.workplace.issue.workflow.domain.WorkflowModel;
import com.workplace.issue.workflow.domain.WorkflowValidator;
import com.workplace.issue.workflow.domain.WorkflowYamlParser;
import com.workplace.issue.workflow.dto.WorkflowProblem;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Stream;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * 저장소의 「AI 개발 흐름」 워크플로우 정의(docs/workflows/ai-dev-flow.yaml)가 서버 파서·검증기를 문제 없이 통과하고 흐름의 핵심 약속(질문
 * 경로·리뷰 횟수 상한·관문 산출물·노드 지시의 필수 문구)을 지키는지 확인한다(WP-1992).
 *
 * <p>왜: 정의는 사람이 손으로 쓴 큰 YAML 이라 고치다 그래프·지시가 깨지기 쉽다. DB 없이 파일만 읽어 빠르게 지킨다.
 */
class AiDevFlowDefinitionTest {

  /** 정의 파일 바이트(크기 검사용). 한 번만 읽는다. */
  private static byte[] bytes;

  /** 파서 결과. 한 번만 파싱한다. */
  private static ParseResult parsed;

  /** 파싱된 모델(파서 문제가 있으면 @BeforeAll 에서 실패한다). */
  private static WorkflowModel model;

  /** 정의 파일의 저장소 상대 경로. */
  private static final String DEFINITION = "docs/workflows/ai-dev-flow.yaml";

  /**
   * 노드 키 → 그 노드의 펼친 지시에 꼭 있어야 하는 문구. 뒤 Task 가 노드별 지시를 채우며 줄만 더한다. 모든 agent_task 공통 문구는 {@link
   * #COMMON_MARKERS} 가 맡는다.
   */
  private static final Map<String, List<String>> NODE_MARKERS =
      Map.ofEntries(
          Map.entry(
              "develop",
              List.of(
                  // 공통 규칙(셸·시작점)
                  "Dangerous rm",
                  "origin/green",
                  // 1단계 이해·설계: 질문 판단, 세 스킬, 계획 파일
                  "brainstorming",
                  "writing-plans",
                  "질문 판단",
                  // 2단계 구현: SDD 와 하위 에이전트, 원장을 notes 로, 「전」 캡처
                  "subagent-driven-development",
                  "원장:",
                  "run_in_background",
                  "-before",
                  // 3단계 자체 리뷰: 리뷰·정리 스킬
                  "/code-review medium",
                  "/simplify",
                  // 4단계 커밋 합치기: 합치기 방법과 뜻 충돌 반려 때의 rebase
                  "git reset --soft",
                  "뜻 충돌",
                  // 5단계 라이브 검증: 격리 스택과 반영 근거
                  "LIVE_STACK_NAME=work-loop",
                  "반영 근거",
                  "검증한 HEAD SHA",
                  // 6단계 PR 올리기: 절차 검사·push·PR 본문 첫 줄
                  "procedure-check",
                  "--no-verify",
                  "개발: ",
                  "절차:",
                  // 리뷰 후속·풀테스트 실패 수정 절
                  "[리뷰 후속]",
                  "[풀테스트 실패] 받기",
                  "cherry-pick -m 1",
                  // 단계 진행 보고와 다시 들어옴 갈래
                  "stepsDone",
                  "결과 `changes`",
                  "결과 `redo_procedure`",
                  "결과 `rebase`",
                  "결과 `followup`",
                  "rework",
                  // 답을 받아 돌아올 때 이어 할 단계를 정하는 notes 칸
                  "현재 단계",
                  // 되돌림을 이슈에 남기고 같은 종류 3번째면 BLOCKED 로 막는다
                  "단계 되돌리기")),
          Map.entry(
              "report",
              // 되돌린 글은 이 PR 의 mergeCommit 으로만 센다(다른 PR 의 되돌림을 세지 않게)
              List.of("사용 가이드", "확인 위치", "`mergeCommit` 의 앞부분")),
          Map.entry(
              "review",
              List.of(
                  "절차 확인",
                  "완료 기준 대조표",
                  "손 머지",
                  "머지 멈춤",
                  "풀테스트",
                  "green",
                  "--admin",
                  "check-migration-versions",
                  // 호스트에서 머지된 PR 이 review 에 남지 않게
                  "결과 `merged` 로 이동",
                  // 풀테스트 실패 되돌림이 develop 으로 들어가는 길(결과 followup)
                  "결과 `followup` 으로 이동",
                  // 머지 멈춤 중 사람이 머지한 PR 의 판정·prUrl 출처
                  "`머지 대기:` 줄이 있으면",
                  "앞 이동들이 낸 `prUrl`")),
          Map.entry("triage", List.of("[분류]", "사람에게 질문", "바로 개발")),
          Map.entry("plan", List.of("비교 조사", "의견 수렴", "기획안")),
          Map.entry("plan_review", List.of("팀장 검토")),
          Map.entry("plan_ok", List.of("확정")),
          Map.entry("handoff", List.of("하위 이슈", "동시 진행: 형제와 따로 가져가도 된다")));

  /**
   * 공통 shared 글마다 있어야 하는 문구. 노드마다가 아니라 그 shared 글에서 한 번 본다 — 문구가 다른 shared 로 옮겨 가거나 짝을 이루는 두
   * 글(report_style·workflow_rules 의 SCHEDULED)이 어긋나면 잡히게 shared 이름별로 나눈다.
   */
  private static final Map<String, List<String>> COMMON_MARKERS =
      Map.of(
          "priorities", List.of("gw-repo", "실행에 조치해야 이 노드가 다시 열린다"),
          // 차단·인증 필요는 WORKING 보고로 풀리지 않는다
          "report_style", List.of("note 쓰는 법", "사람이 실행에 조치해야만 풀린다", "'SCHEDULED'"),
          "shell_rules", List.of("Dangerous rm"),
          "repo_facts", List.of(".work-loop/project.md", "현재 단계"),
          "blocked", List.of("같은 단계가 3번 되풀이돼도", "실행에 조치해야 이 노드가 다시 열린다"),
          // report_style 이 시키는 SCHEDULED 를 허용 목록에도 둔다
          "workflow_rules", List.of("WORKFLOW_USE_MOVE", "다음 회차 대기(SCHEDULED"));

  /** 모든 agent_task 가 use 해야 하는 공통 shared 이름 — 위 문구 표의 이름이 곧 그 목록이다(두 곳에 적지 않게). */
  private static final List<String> COMMON_SHARED = List.copyOf(COMMON_MARKERS.keySet());

  /** 개발·리뷰 노드(long_jobs·subagent_wait 를 쓰는 노드). */
  private static final List<String> DEV_NODES = List.of("develop", "review");

  /** 개발·리뷰 노드의 펼친 지시에 있어야 하는 문구. */
  private static final List<String> DEV_MARKERS =
      List.of(
          "bg-job", // long_jobs
          "run_in_background"); // subagent_wait

  /** 노드 지시에 남으면 안 되는 실행기 몫·스킬 폴더 경로 문구. */
  private static final List<String> FORBIDDEN =
      List.of("스킬 폴더", "wake", "「살아 있는 양보」", "GW-NEXT-CHECK");

  /**
   * 워크플로우 노드에서 서버가 409(WORKFLOW_USE_MOVE)로 거절하는 상태 보고 문구. 왜: 질문·검토·끝내기는 결과 이동으로만 하므로 지시가 이 보고를 시키면
   * 첫 보고에서 막힌다(WP-1992 최종 리뷰 C1).
   */
  private static final List<String> MOVE_ONLY_STATES =
      List.of("INPUT_REQUIRED", "REVIEW", "COMPLETED", "CANCELED", "REJECTED");

  /** 검증기가 use 로 펼친 지시의 문서 합계 상한(자). */
  private static final int EXPANDED_LIMIT = 1_048_576;

  /** 정의 파일을 한 번 읽고 파싱한다. 왜: 테스트마다 큰 YAML 을 다시 파싱할 필요가 없고, 파서 문제는 여기서 한 번 드러난다. */
  @BeforeAll
  static void loadDefinition() throws IOException {
    bytes = Files.readAllBytes(RepoFiles.findUp(DEFINITION));
    parsed = WorkflowYamlParser.parse(new String(bytes, StandardCharsets.UTF_8));
    assertThat(parsed.model()).as("파서 문제: %s", parsed.problems()).isNotNull();
    model = parsed.model();
  }

  /** 정의의 역할 구성원 전부를 프로젝트 구성원으로 만든 표 — owner 역할 구성원은 사람(USER), 나머지는 외부 실행 AI. */
  private static ProjectMembers members(WorkflowModel m) {
    // 사람 판정을 username 하드코딩 대신 owner(확인자) 역할 구성원 집합으로 한다
    Set<String> humans = new HashSet<>(m.roles().get("owner").memberUsernames());
    return ProjectMembers.of(
        m.roles().values().stream()
            .flatMap(r -> r.memberUsernames().stream())
            .map(
                u ->
                    humans.contains(u)
                        ? new ProjectMembers.Member(u, "USER", null)
                        : new ProjectMembers.Member(u, "AGENT", "EXTERNAL"))
            .toList());
  }

  private static List<WorkflowModel.Node> agentTasks() {
    return model.nodes().values().stream().filter(n -> "agent_task".equals(n.type())).toList();
  }

  /** 키로 노드를 꺼낸다(없으면 실패). */
  private static WorkflowModel.Node node(String key) {
    WorkflowModel.Node n = model.nodes().get(key);
    assertThat(n).as("%s 노드", key).isNotNull();
    return n;
  }

  /** text 에 markers 가 모두 들어 있는지 본다(label 은 실패 메시지용). */
  private static void assertContainsAll(String label, String text, List<String> markers) {
    for (String marker : markers) {
      assertThat(text).as("%s 의 '%s'", label, marker).contains(marker);
    }
  }

  @Test
  @DisplayName("정의 파일이 파서·검증기 문제 없이 통과한다(ERROR·WARNING 모두 0)")
  void noProblemsAtAll() {
    assertThat(parsed.problems()).isEmpty();

    List<WorkflowProblem> problems =
        WorkflowValidator.validate(model, members(model), parsed.source());

    assertThat(problems).isEmpty();
  }

  @Test
  @DisplayName("모든 agent_task 는 사람에게 묻는 길(<키>_ask, returnTo 가 자기)을 가진다")
  void everyAgentTaskHasAskPath() {
    for (WorkflowModel.Node n : agentTasks()) {
      WorkflowModel.Outcome ask = n.outcomes().get("ask");
      assertThat(ask).as("%s 의 ask 결과", n.key()).isNotNull();
      assertThat(ask.to()).isEqualTo(n.key() + "_ask");
      WorkflowModel.Node askNode = node(ask.to());
      assertThat(askNode.type()).isEqualTo("human_task");
      assertThat(askNode.returnTo()).isEqualTo(n.key());
    }
  }

  @Test
  @DisplayName("review 는 같은 실행에서 3번째 들어오면 사람에게 알린다(maxVisits 3)")
  void reviewMaxVisitsIsThree() {
    assertThat(node("review").maxVisits()).isEqualTo(3);
  }

  @Test
  @DisplayName("관문 노드는 산출물(검증한 HEAD·PR 주소·기획 문서)을 꼭 내놓아야 한다")
  void gateOutputsRequired() {
    assertOutput("develop", "verifiedHead", "string");
    assertOutput("develop", "prUrl", "url");
    assertOutput("plan", "planDoc", "url");
  }

  private static void assertOutput(String node, String name, String type) {
    WorkflowModel.OutputSpec spec = node(node).outputs().get(name);
    assertThat(spec).as("%s.%s", node, name).isNotNull();
    assertThat(spec.type()).isEqualTo(type);
    assertThat(spec.required()).isTrue();
  }

  @Test
  @DisplayName("개발 노드로 오는 길과 나가는 길")
  void developRoutes() {
    WorkflowModel.Node n = node("develop");

    assertThat(n.outcomes().keySet()).containsExactlyInAnyOrder("submitted", "ask");
    assertThat(n.outcomes().get("submitted").to()).isEqualTo("review");
    assertThat(n.outcomes().get("submitted").assignTo()).isEqualTo("lead");
    assertThat(n.maxVisits()).isEqualTo(8);
    for (String outcome : List.of("changes", "redo_procedure", "rebase", "followup")) {
      assertThat(node("review").outcomes().get(outcome).to())
          .as("review.%s", outcome)
          .isEqualTo("develop");
    }
    assertThat(node("triage").outcomes().get("ready").to()).isEqualTo("develop");
    assertThat(node("handoff").outcomes().get("done").to()).isEqualTo("develop");
    assertThat(node("confirm").outcomes().get("rework").to()).isEqualTo("develop");
  }

  /** 합쳐서 없어진 개발자 노드 키. 지시·공통 글이 이 키를 가리키면 펼친 지시가 끊긴 참조가 된다. */
  private static final List<String> REMOVED_NODES =
      List.of(
          "understand",
          "implement",
          "self_review",
          "squash",
          "live_verify",
          "open_pr",
          "followup_fix");

  @Test
  @DisplayName("지시·공통 글이 없어진 노드 이름을 가리키지 않는다")
  void noRemovedNodeReferences() {
    Stream.concat(
            model.shared().entrySet().stream()
                .map(e -> Map.entry("shared " + e.getKey(), e.getValue())),
            model.nodes().values().stream()
                .filter(n -> n.instructions() != null)
                .map(n -> Map.entry("node " + n.key(), n.instructions())))
        .forEach(
            e -> {
              for (String k : REMOVED_NODES) {
                // 단어 경계로 키 전체만 잡는다(followup·review 같은 결과 이름은 걸리지 않는다)
                assertThat(e.getValue())
                    .as("%s 의 옛 노드 이름 %s", e.getKey(), k)
                    .doesNotContainPattern("\\b" + k + "\\b");
              }
            });
  }

  @Test
  @DisplayName("사용자 노드는 열두 개다(개발자 7노드를 개발 하나로 합쳤다)")
  void nodeSetIsTwelve() {
    Set<String> keys = new HashSet<>(model.nodes().keySet());
    keys.removeIf(k -> k.endsWith("_ask"));

    assertThat(keys)
        .containsExactlyInAnyOrder(
            "start",
            "triage",
            "plan",
            "plan_review",
            "plan_gate",
            "plan_ok",
            "handoff",
            "develop",
            "review",
            "report",
            "confirm",
            "done");
  }

  @Test
  @DisplayName("로컬 저장소를 만지는 노드는 local-repo 능력을 요구한다")
  void localRepoNodes() {
    for (String key : List.of("develop", "report", "review", "plan", "handoff")) {
      assertThat(node(key).requires()).as("%s 의 requires", key).contains("local-repo");
    }
  }

  @Test
  @DisplayName("파일 크기가 읽기 상한(256 KiB)보다 작다")
  void fitsSizeLimit() {
    assertThat(bytes.length).isLessThan(256 * 1024);
  }

  @Test
  @DisplayName("펼친 지시 합계가 검증기 상한(1,048,576자)보다 작고 실행기 몫 문구가 없다")
  void expandedInstructionsFitLimit() {
    int total = 0;
    for (WorkflowModel.Node n : model.nodes().values()) {
      String text = n.instructions() == null ? "" : n.instructions();
      total += text.length();
      for (String word : FORBIDDEN) {
        assertThat(text).as("%s 지시의 '%s'", n.key(), word).doesNotContain(word);
      }
    }
    assertThat(total).isLessThan(EXPANDED_LIMIT);
  }

  @Test
  @DisplayName("develop 지시에 6단계와 리뷰 후속 절 제목이 이 순서로 있다")
  void developStepsInOrder() {
    String text = node("develop").instructions();
    int last = -1;
    for (String heading :
        List.of(
            "### 1단계",
            "### 2단계",
            "### 3단계",
            "### 4단계",
            "### 5단계",
            "### 6단계",
            "### 리뷰 후속·풀테스트 실패 수정")) {
      int at = text.indexOf(heading);
      assertThat(at).as("develop 지시의 '%s' 위치", heading).isGreaterThan(last);
      last = at;
    }
  }

  @Test
  @DisplayName("공통 문구는 shared 글에 있고, 모든 agent_task 는 그 shared 를 use 한다")
  void commonSharedUsedByEveryAgentTask() {
    // 펼친 지시에 shared 글이 들어가는 것은 파서가 보장하므로 글은 한 번, 노드는 use 만 본다
    COMMON_MARKERS.forEach(
        (name, markers) -> assertContainsAll("shared " + name, model.shared().get(name), markers));
    // 목록 항목이 앞 문장에 붙지 않았다(줄바꿈이 빠진 편집을 잡는다). shared 와 노드 지시 모두 본다
    Stream.concat(
            model.shared().entrySet().stream()
                .map(e -> Map.entry("shared " + e.getKey(), e.getValue())),
            model.nodes().values().stream()
                .filter(n -> n.instructions() != null)
                .map(n -> Map.entry("node " + n.key(), n.instructions())))
        .forEach(
            e ->
                assertThat(e.getValue())
                    .as("%s 의 목록 줄바꿈", e.getKey())
                    .doesNotContainPattern("\\S {2,}- \\S"));
    for (WorkflowModel.Node n : agentTasks()) {
      assertThat(n.use()).as("%s 의 use", n.key()).containsAll(COMMON_SHARED);
    }
  }

  @Test
  @DisplayName("펼친 노드 지시에 필수 문구가 남아 있다(공용 지시가 빠지거나 요약되지 않았다)")
  void nodeInstructions_keepMarkers() {
    for (String key : DEV_NODES) {
      assertContainsAll(key + " 지시", node(key).instructions(), DEV_MARKERS);
    }
    NODE_MARKERS.forEach(
        (key, markers) -> assertContainsAll(key + " 지시", node(key).instructions(), markers));
  }

  @Test
  @DisplayName("노드 지시가 서버가 거절하는 상태 보고(INPUT_REQUIRED·REVIEW·COMPLETED·CANCELED·REJECTED)를 시키지 않는다")
  void noMoveOnlyStateReports() {
    for (WorkflowModel.Node n : agentTasks()) {
      for (String state : MOVE_ONLY_STATES) {
        // 따옴표 종류·띄어쓰기에 상관없이 state: 'X' 형태의 보고 시킴을 잡는다
        assertThat(n.instructions())
            .as("%s 지시의 state %s", n.key(), state)
            .doesNotContainPattern("state\\s*:\\s*[\"'`]?" + state);
      }
    }
  }

  /**
   * review 에서 처음 들어가는 노드로 가는 결과는 keep 이 아니다 — merged 는 report, followup 은 develop 이지만 둘 다 developer
   * 로 넘긴다. 왜: keep 의 기준은 「멈추는 노드의 가장 최근 담당」이라 처음 방문이면 비어 ASSIGNEE_REQUIRED 로 거절된다(최종 리뷰 C2).
   */
  @Test
  @DisplayName("review 의 merged·followup 결과는 keep 이 아니라 developer 로 넘긴다")
  void reviewFirstVisitOutcomesAreNotKeep() {
    WorkflowModel.Node review = node("review");

    for (String outcome : List.of("merged", "followup")) {
      assertThat(review.outcomes().get(outcome).assignTo())
          .as("review.%s", outcome)
          .isEqualTo("developer");
    }
  }

  /**
   * 머지 없이 닫힌 PR 을 owner 가 「그만」으로 답하면 review 에서 끝낼 길이 있다. 왜: 없으면 ask → answered 로 review 에 돌아와 같은 닫힌
   * PR 을 다시 묻는 고리가 된다(code-review 가 잡은 빈틈). 지시 문구가 아니라 그래프의 결과로 단언한다.
   */
  @Test
  @DisplayName("review 는 닫힌 PR 을 끝낼 결과 drop(의견 필수)을 가진다")
  void reviewHasDropOutcome() {
    WorkflowModel.Outcome drop = node("review").outcomes().get("drop");

    assertThat(drop).as("review.drop").isNotNull();
    assertThat(drop.to()).isEqualTo("done");
    assertThat(drop.requireComment()).isTrue();
  }

  @Test
  @DisplayName("triage 는 「진행 안 함」 갈래로 끝낼 결과 drop(의견 필수)을 가진다")
  void triageHasDropOutcome() {
    WorkflowModel.Outcome drop = node("triage").outcomes().get("drop");

    assertThat(drop).as("triage.drop").isNotNull();
    assertThat(drop.to()).isEqualTo("done");
    assertThat(drop.requireComment()).isTrue();
  }

  /** 펼친 지시에는 shared 이름이 붙지 않으므로 글마다 제목을 달아 노드 지시의 「…」 참조가 가리킬 곳을 둔다(최종 리뷰 I2). */
  @Test
  @DisplayName("모든 shared 글은 「## 」 제목으로 시작한다")
  void sharedTextsStartWithHeading() {
    model
        .shared()
        .forEach((name, text) -> assertThat(text).as("shared %s", name).startsWith("## "));
  }
}
