package com.workplace.issue.workflow;

import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.issue.workflow.domain.ParseResult;
import com.workplace.issue.workflow.domain.ProjectMembers;
import com.workplace.issue.workflow.domain.WorkflowModel;
import com.workplace.issue.workflow.domain.WorkflowValidator;
import com.workplace.issue.workflow.domain.WorkflowYamlParser;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.time.Duration;
import java.util.List;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * 저장소의 「운영 배포」 워크플로우 정의(docs/workflows/deploy-flow.yaml)가 서버 파서·검증기를 문제 없이 통과하고, 플러그인 deploy 스킬과 맞춘
 * 계약(결과 이름·준비 산출물)과 흐름의 약속(승인 없이 반영 없음, 실패하면 승인으로, 하루 지나면 다시 알림)을 지키는지 확인한다(WP-2144).
 *
 * <p>왜: 프로젝트마다 이 파일을 붙여 넣어 게시하므로 파일이 깨지면 모든 앱의 배포 흐름이 같이 깨진다. 결과 이름은 스킬(WP-2143)이 그대로 쓰므로 한쪽만 바꾸면
 * 노드를 넘길 수 없다 — 두 파일을 함께 읽어 어긋남을 잡는다. DB 없이 파일만 읽어 빠르게 지킨다.
 */
class DeployFlowDefinitionTest {

  /** 정의 파일의 저장소 상대 경로. */
  private static final String DEFINITION = "docs/workflows/deploy-flow.yaml";

  /** 결과 이름·산출물의 짝인 deploy 스킬 본문. */
  private static final String SKILL = "plugins/genia-works/skills/deploy/SKILL.md";

  private static ParseResult parsed;
  private static WorkflowModel model;
  private static String skill;

  /** 정의와 스킬을 한 번 읽는다. 파서 문제는 여기서 드러난다. */
  @BeforeAll
  static void load() throws IOException {
    parsed =
        WorkflowYamlParser.parse(
            new String(Files.readAllBytes(RepoFiles.findUp(DEFINITION)), StandardCharsets.UTF_8));
    assertThat(parsed.model()).as("파서 문제: %s", parsed.problems()).isNotNull();
    model = parsed.model();
    skill = new String(Files.readAllBytes(RepoFiles.findUp(SKILL)), StandardCharsets.UTF_8);
  }

  /** 정의의 역할 구성원을 프로젝트 구성원으로 — 승인자는 사람, 배포 담당은 외부 실행 AI. */
  private static ProjectMembers members() {
    return ProjectMembers.of(
        java.util.stream.Stream.concat(
                model.roles().get("owner").memberUsernames().stream()
                    .map(u -> new ProjectMembers.Member(u, "USER", null)),
                model.roles().get("deployer").memberUsernames().stream()
                    .map(u -> new ProjectMembers.Member(u, "AGENT", "EXTERNAL")))
            .toList());
  }

  private static WorkflowModel.Node node(String key) {
    WorkflowModel.Node n = model.nodes().get(key);
    assertThat(n).as("%s 노드", key).isNotNull();
    return n;
  }

  /** 노드의 결과 이름 → 도착 노드를 「이름→도착」 글로 모은다(순서 그대로). */
  private static List<String> routes(String key) {
    return node(key).outcomes().values().stream()
        .filter(o -> !"ask".equals(o.key()))
        .map(o -> o.key() + "→" + o.to())
        .toList();
  }

  @Test
  @DisplayName("정의 파일이 파서·검증기 문제 없이 통과한다(ERROR·WARNING 모두 0)")
  void noProblemsAtAll() {
    assertThat(parsed.problems()).isEmpty();
    assertThat(WorkflowValidator.validate(model, members(), parsed.source())).isEmpty();
  }

  @Test
  @DisplayName("배포 담당에게 맡기면 배포 준비부터 시작하고, 역할은 배포 담당(AI)·승인자(사람)다")
  void startsAtPrepareByDeployerRole() {
    assertThat(model.roles()).containsOnlyKeys("deployer", "owner");
    assertThat(model.start()).hasSize(1);
    assertThat(model.start().get(0).assigneeRole()).isEqualTo("deployer");
    assertThat(model.start().get(0).to()).isEqualTo("prepare");
  }

  @Test
  @DisplayName(
      "흐름: 준비 ready→승인·nothing→끝·blocked→막힘 확인, 승인 approve→반영·reject→끝, 반영 deployed→끝·failed→승인")
  void routesMatchContract() {
    assertThat(routes("prepare"))
        .containsExactly("ready→approve", "nothing→finish", "blocked→unblock");
    assertThat(routes("approve")).containsExactly("approve→deploy", "reject→finish");
    assertThat(routes("unblock")).containsExactly("retry→prepare", "cancel→finish");
    assertThat(routes("deploy")).containsExactly("deployed→finish", "failed→approve");
    // 반영(deploy)으로 들어오는 길은 승인의 approve 와, 반영 중 물은 질문의 답(되돌아옴)뿐이다 — 승인 없이 반영하지 않는다.
    assertThat(
            model.nodes().values().stream()
                .flatMap(
                    n ->
                        n.outcomes().values().stream()
                            .map(o -> n.key() + "." + o.key() + "→" + o.to()))
                .filter(r -> r.endsWith("→deploy")))
        .containsExactly("approve.approve→deploy", "deploy_ask.answered→deploy");
  }

  @Test
  @DisplayName("거절·그만두기·낼 것 없음·결과 보고는 의견이 필수이고, 사람 노드는 하루 지나면 다시 알린다")
  void commentsAndReminders() {
    assertThat(node("approve").outcomes().get("reject").requireComment()).isTrue();
    assertThat(node("unblock").outcomes().get("cancel").requireComment()).isTrue();
    for (String o : List.of("ready", "nothing", "blocked")) {
      assertThat(node("prepare").outcomes().get(o).requireComment()).as(o).isTrue();
    }
    for (String o : List.of("deployed", "failed")) {
      assertThat(node("deploy").outcomes().get(o).requireComment()).as(o).isTrue();
    }
    for (String h : List.of("approve", "unblock")) {
      assertThat(node(h).timeout().after()).as(h).isEqualTo(Duration.ofDays(1));
      assertThat(node(h).timeout().then()).as(h).isEqualTo("remind");
    }
  }

  @Test
  @DisplayName("AI 노드는 사람에게 묻는 길을 갖고, 준비는 산출물 tag·commit·previousTag 를 내놓는다")
  void askPathsAndOutputs() {
    for (String a : List.of("prepare", "deploy")) {
      assertThat(node(a).type()).isEqualTo("agent_task");
      assertThat(node(a).outcomes()).as(a).containsKey("ask");
      assertThat(node(a).requires()).as(a).contains("local-repo");
    }
    // 산출물은 ready 에서만 의미가 있어 required 가 아니다(nothing·blocked 는 낼 태그가 없다) — 꼭 넣는 것은 스킬이 지킨다.
    assertThat(node("prepare").outputs()).containsOnlyKeys("tag", "commit", "previousTag");
  }

  @Test
  @DisplayName("노드 지시는 deploy 스킬을 부르고, 결과 이름·산출물이 스킬 본문과 같다")
  void instructionsCallSkillAndMatchIt() {
    assertThat(node("prepare").instructions()).contains("/genia-works:deploy <이 이슈 키> prepare");
    assertThat(node("deploy").instructions()).contains("/genia-works:deploy <이 이슈 키> apply");
    for (String o : List.of("ready", "nothing", "blocked", "deployed", "failed", "approve")) {
      assertThat(skill).as("스킬의 결과 %s", o).contains("`" + o + "`");
    }
    assertThat(skill).contains("{ tag, commit: <전체 SHA>, previousTag: <지금 운영 태그> }");
  }
}
