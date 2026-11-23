package com.workplace.issue.workflow;

import static com.workplace.issue.workflow.RunModels.DEV1;
import static com.workplace.issue.workflow.RunModels.DEV2;
import static com.workplace.issue.workflow.RunModels.LEAD;
import static com.workplace.issue.workflow.RunModels.OWNER;
import static com.workplace.issue.workflow.RunModels.byContext;
import static com.workplace.issue.workflow.RunModels.byRole;
import static com.workplace.issue.workflow.RunModels.decision;
import static com.workplace.issue.workflow.RunModels.end;
import static com.workplace.issue.workflow.RunModels.ids;
import static com.workplace.issue.workflow.RunModels.list;
import static com.workplace.issue.workflow.RunModels.out;
import static com.workplace.issue.workflow.RunModels.role;
import static com.workplace.issue.workflow.RunModels.start;
import static com.workplace.issue.workflow.RunModels.task;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.issue.workflow.domain.MoveRules;
import com.workplace.issue.workflow.domain.RunRoleMembers;
import com.workplace.issue.workflow.domain.RunState;
import com.workplace.issue.workflow.domain.WorkflowModel;
import com.workplace.issue.workflow.domain.WorkflowModel.Node;
import com.workplace.issue.workflow.domain.WorkflowRouting;
import com.workplace.issue.workflow.domain.WorkflowRouting.Route;
import com.workplace.issue.workflow.domain.WorkflowRouting.StartMatch;
import com.workplace.issue.workflow.dto.MoveRequest;
import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/** 시작 조건·자동 노드 연쇄(설계 §6·§8)를 DB·Spring 없이 확인한다(WP-1985). */
class WorkflowRoutingTest {

  private static final WorkflowModel SPEC = RunModels.spec();
  private static final RunRoleMembers SPEC_MEMBERS = RunModels.specMembers(SPEC);

  /** decision 하나: plan.score == 1 → a, plan.flag == "true" → b, 그 밖 → c. */
  private static final WorkflowModel DECIDE =
      RunModels.model(
          List.of(role("developer", "dev1@example.com")),
          List.of(),
          start("start"),
          decision("d", "c", byContext("plan.score", 1L, "a"), byContext("plan.flag", "true", "b")),
          task("a", "developer", out("go", "z", null)),
          task("b", "developer", out("go", "z", null)),
          task("c", "developer", out("go", "z", null)),
          end("z"));

  private static String stop(Map<String, Object> context) {
    Route r = WorkflowRouting.route(DECIDE, "d", List.of(), context, SPEC_MEMBERS);
    assertThat(r.limitExceeded()).isFalse();
    return r.stopNode();
  }

  @Test
  @DisplayName("start 조건은 위에서 첫 매치 — 매치된 구성원만 담는다")
  void start_firstConditionWins() {
    Optional<StartMatch> m = WorkflowRouting.start(SPEC, ids(DEV1, LEAD), SPEC_MEMBERS);
    assertThat(m).isPresent();
    assertThat(m.get().to()).isEqualTo("triage");
    assertThat(m.get().matched()).containsExactly(LEAD);

    Optional<StartMatch> devOnly = WorkflowRouting.start(SPEC, ids(DEV2, DEV1), SPEC_MEMBERS);
    assertThat(devOnly.get().to()).isEqualTo("dev");
    assertThat(devOnly.get().matched()).containsExactly(DEV2, DEV1);
  }

  @Test
  @DisplayName("어느 start 조건에도 맞는 담당이 없으면 빈 값")
  void start_noMatch_empty() {
    assertThat(WorkflowRouting.start(SPEC, ids(OWNER), SPEC_MEMBERS)).isEmpty();
    assertThat(WorkflowRouting.start(SPEC, ids(), SPEC_MEMBERS)).isEmpty();
    assertThat(WorkflowRouting.start(SPEC, ids(99L), SPEC_MEMBERS)).isEmpty();
  }

  @Test
  @DisplayName("context 값이 없으면 불일치 — default 로 간다")
  void contextMissing_goesDefault() {
    assertThat(stop(Map.of())).isEqualTo("c");
    assertThat(stop(Map.of("plan", Map.of()))).isEqualTo("c");
    assertThat(stop(Map.of("plan", "not-a-map"))).isEqualTo("c");
  }

  @Test
  @DisplayName("수는 값으로 비교한다 — 1L 과 1.0 과 1.00 은 같다")
  void numberEquals_byValue() {
    assertThat(stop(Map.of("plan", Map.of("score", 1.0)))).isEqualTo("a");
    assertThat(stop(Map.of("plan", Map.of("score", 1)))).isEqualTo("a");
    assertThat(stop(Map.of("plan", Map.of("score", new BigDecimal("1.00"))))).isEqualTo("a");
    assertThat(stop(Map.of("plan", Map.of("score", 1.5)))).isEqualTo("c");
    assertThat(stop(Map.of("plan", Map.of("score", "1")))).isEqualTo("c");
  }

  @Test
  @DisplayName("글 \"true\" 는 불리언 true 와 같지 않다")
  void stringTrue_notEqualsBoolean() {
    assertThat(stop(Map.of("plan", Map.of("flag", Boolean.TRUE)))).isEqualTo("c");
    assertThat(stop(Map.of("plan", Map.of("flag", "true")))).isEqualTo("b");
  }

  @Test
  @DisplayName("assigneeRole 은 담당 확정 전의 기준 사람들로 판정한다")
  void assigneeRole_usesBasisBeforeResolution() {
    // triage(lead) --go(assignTo developer)--> route: developer 면 dev, 아니면 review
    WorkflowModel model =
        RunModels.model(
            List.of(
                role("lead", "teamleader@iacloud.kr"),
                role("developer", "dev1@example.com", "dev2@example.com")),
            List.of(),
            start("start"),
            task("triage", "lead", out("go", "route", "developer"), out("keep", "route", "keep")),
            decision("route", "review", byRole("developer", "dev")),
            task("dev", "developer", out("done", "end", null)),
            task("review", "lead", out("done", "end", null)),
            end("end"));
    RunRoleMembers members = RunModels.specMembers(model);

    assertThat(WorkflowRouting.route(model, "route", list(DEV1), Map.of(), members).stopNode())
        .isEqualTo("dev");
    assertThat(WorkflowRouting.route(model, "route", list(LEAD), Map.of(), members).stopNode())
        .isEqualTo("review");

    RunState s = RunModels.state(model, "triage", 0, list(LEAD), ids(LEAD), Map.of(), Map.of());
    // assigneeIds 없음 + 역할 → 그 역할의 지금 구성원이 기준: dev 로 가고 담당은 아직 둘이라 고르라 한다
    MoveRules.MovePlan go =
        MoveRules.plan(new MoveRequest("triage", "go", null, null, null, 0, "k"), s, members);
    assertThat(go.basis()).containsExactly(DEV1, DEV2);
    assertThat(go.route().stopNode()).isEqualTo("dev");
    assertThat(go.resolution().violation().code()).isEqualTo("WORKFLOW_ASSIGNEE_REQUIRED");
    // keep → 현재 노드 담당(lead)이 기준: review
    MoveRules.MovePlan keep =
        MoveRules.plan(new MoveRequest("triage", "keep", null, null, null, 0, "k"), s, members);
    assertThat(keep.basis()).containsExactly(LEAD);
    assertThat(keep.route().stopNode()).isEqualTo("review");
    // keep·생략의 assigneeIds 는 기준이 아니다(R28 — end 에선 보지 않는 id 로 decision 을 몰 수 없게). 기준은 그대로 lead
    MoveRules.MovePlan explicit =
        MoveRules.plan(
            new MoveRequest("triage", "keep", null, list(DEV2), null, 0, "k"), s, members);
    assertThat(explicit.basis()).containsExactly(LEAD);
    assertThat(explicit.route().stopNode()).isEqualTo("review");
    // 역할 assignTo 의 assigneeIds 는 모두 그 역할 구성원이면 기준이다
    MoveRules.MovePlan picked =
        MoveRules.plan(new MoveRequest("triage", "go", null, list(DEV2), null, 0, "k"), s, members);
    assertThat(picked.basis()).containsExactly(DEV2);
    assertThat(picked.route().stopNode()).isEqualTo("dev");
  }

  /** decision n 개가 줄지어 있고 끝에 task 하나가 있는 모델. */
  private static WorkflowModel chain(int decisions) {
    List<Node> nodes = new ArrayList<>();
    nodes.add(start("start"));
    for (int i = 1; i <= decisions; i++) {
      String next = i == decisions ? "work" : "d" + (i + 1);
      nodes.add(decision("d" + i, next));
    }
    nodes.add(task("work", "developer", out("done", "end", null)));
    nodes.add(end("end"));
    return RunModels.model(
        List.of(role("developer", "dev1@example.com")), List.of(), nodes.toArray(Node[]::new));
  }

  @Test
  @DisplayName("자동 노드 20 단계까지는 통과한다")
  void twentySteps_ok() {
    Route r = WorkflowRouting.route(chain(20), "d1", List.of(), Map.of(), SPEC_MEMBERS);
    assertThat(r.limitExceeded()).isFalse();
    assertThat(r.stopNode()).isEqualTo("work");
    assertThat(r.passed()).hasSize(20);
    assertThat(r.passed().get(0).nodeKey()).isEqualTo("d1");
    assertThat(r.passed().get(0).to()).isEqualTo("d2");
  }

  @Test
  @DisplayName("21 번째 자동 노드에서 멈추고 한도 초과로 알린다")
  void twentyOneSteps_limitExceeded() {
    Route r = WorkflowRouting.route(chain(21), "d1", List.of(), Map.of(), SPEC_MEMBERS);
    assertThat(r.limitExceeded()).isTrue();
    assertThat(r.passed()).hasSize(20);
    assertThat(r.stopNode()).isEqualTo("d21");
  }

  @Test
  @DisplayName("목적이 task 면 지나는 노드 없이 그 자리에 선다")
  void taskTarget_stopsImmediately() {
    Route r = WorkflowRouting.route(SPEC, "review", List.of(), Map.of(), SPEC_MEMBERS);
    assertThat(r.passed()).isEmpty();
    assertThat(r.stopNode()).isEqualTo("review");
    assertThat(r.limitExceeded()).isFalse();
  }
}
