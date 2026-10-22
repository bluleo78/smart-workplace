package com.workplace.issue;

import static com.workplace.jooq.Tables.AGENT_WORK;
import static com.workplace.jooq.Tables.ISSUE;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import com.workplace.issue.service.AgentWorkService;
import com.workplace.user.repository.UserRepository;
import com.workplace.user.service.UserService;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpMethod;

/**
 * 외부 실행 AI 구성원을 담당자로 두면 "시작 전"(SUBMITTED) 작업이 만들어지고, 첫 보고·MCP 쓰기가 같은 행을 작업 중(WORKING)으로 이어
 * 쓴다(WP-377, A2A submitted). 담당자가 들어가는 두 곳(이슈 생성·담당자 교체)과 내부 AI·사람·종료 이슈 제외, 겹침(생성+터치) 시 행이 하나뿐임을
 * 실제 HTTP 요청으로 검증한다. 시드 AI 구성원(agentId)은 기본 내부 실행이라 각 테스트가 필요할 때만 외부로 바꾼다.
 */
class AgentWorkSubmittedTest extends AgentWorkTestSupport {

  @Autowired private AgentWorkService agentWorkService;
  @Autowired private UserService userService;
  @Autowired private UserRepository userRepository;

  /** 시드 이슈는 사람·AI 가 이미 담당자 — 담당자 교체의 "추가" 를 만들려고 AI 를 빼 둔다(작업이 없어 종료할 것도 없다). */
  @BeforeEach
  void removeAgentFromSeedIssue() {
    assertOk(putAssignees(jwtToken, List.of(humanId), null));
  }

  /** 담당자 교체로 시드 이슈에 AI 구성원을 추가한다. */
  private void addAgentAsAssignee() {
    assertOk(putAssignees(jwtToken, List.of(humanId, agentId), null));
  }

  /** 새 이슈를 HTTP 로 만든다 — 토큰·수행 도구 헤더·담당자 지정. 새 이슈의 id 를 돌려준다. */
  private long createIssue(String token, String tool, List<Long> assigneeIds) {
    var res =
        call(
            HttpMethod.POST,
            "/api/v1/projects/" + projectKey + "/issues",
            token,
            Map.of("title", "새 이슈", "assigneeIds", assigneeIds),
            tool);
    assertOk(res);
    return json(res).get("id").asLong();
  }

  // ---------------------------------------------------------------- 생성

  /** 담당자 교체로 외부 AI 를 추가하면 도구를 모르는 SUBMITTED 작업이 하나 생기고 이벤트도 한 건. */
  @Test
  void 담당자_교체로_외부_AI를_추가하면_SUBMITTED_행과_이벤트_하나() {
    makeExternal(agentId);
    addAgentAsAssignee();
    var w = activeWork(issueId, agentId).orElseThrow();
    assertThat(w.state()).isEqualTo("SUBMITTED");
    assertThat(w.tool()).isNull();
    assertThat(allStates(issueId, agentId)).containsExactly("SUBMITTED");
    assertThat(eventStates(issueId, agentId)).containsExactly("SUBMITTED");
  }

  @Test
  void 사람이_외부_AI를_담당자로_이슈를_만들면_SUBMITTED() {
    makeExternal(agentId);
    long created = createIssue(jwtToken, null, List.of(agentId));
    assertThat(activeWork(created, agentId).orElseThrow().state()).isEqualTo("SUBMITTED");
    assertThat(eventStates(created, agentId)).containsExactly("SUBMITTED");
  }

  /** (a) 외부 AI 가 도구 헤더로 자기를 담당자로 이슈를 만들어도 행은 정확히 하나 — 작업 중이고 도구가 채워진다. */
  @Test
  void a_외부_AI가_도구_헤더로_자기를_담당자로_만들면_행은_하나_WORKING_도구_채움() {
    makeExternal(agentId);
    long created = createIssue(akToken, TOOL, List.of(agentId));
    assertThat(allStates(created, agentId)).hasSize(1);
    var w = activeWork(created, agentId).orElseThrow();
    assertThat(w.state()).isEqualTo("WORKING");
    assertThat(w.tool()).isEqualTo(TOOL);
    // 만들어진 시작 전 행이 이력을 남기고 터치가 같은 행을 작업 중으로 이어 쓴 것 — 이력은 둘뿐.
    assertThat(eventStates(created, agentId)).containsExactly("SUBMITTED", "WORKING");
  }

  /** (c) 내부 AI·사람은 담당자로 들어와도 작업을 만들지 않는다. */
  @Test
  void c_내부_AI와_사람_담당자_추가는_행_없음() {
    // agentId 는 기본 내부 실행.
    assertOk(putAssignees(jwtToken, List.of(humanId, agentId, otherId), null));
    long created = createIssue(jwtToken, null, List.of(agentId, otherId));
    assertThat(activeCount(issueId)).isZero();
    assertThat(activeCount(created)).isZero();
  }

  /** (d) 이미 종료(DONE)된 이슈에 외부 AI 를 담당자로 추가해도 작업을 만들지 않는다. */
  @Test
  void d_닫힌_이슈에_담당자를_추가하면_행_없음() {
    makeExternal(agentId);
    assertOk(patch(jwtToken, Map.of("status", "DONE"), null));
    addAgentAsAssignee();
    assertThat(allStates(issueId, agentId)).isEmpty();
  }

  /** 같은 추가가 다시 와도(재시도·경합) 행·이벤트가 늘지 않는다. */
  @Test
  void 같은_추가를_되풀이해도_멱등() {
    makeExternal(agentId);
    addAgentAsAssignee();
    inTenant(
        () -> {
          agentWorkService.submitForAssignees(
              issueId, "TODO", userRepository.findAssigneeInfos(List.of(agentId), TENANT_ID));
          return null;
        });
    assertThat(allStates(issueId, agentId)).containsExactly("SUBMITTED");
    assertThat(eventStates(issueId, agentId)).containsExactly("SUBMITTED");
  }

  // ---------------------------------------------------------------- 시작·종료

  /** 첫 보고(상태 생략)는 새 행이 아니라 SUBMITTED 행을 WORKING 으로 — 비어 있던 도구도 요청 값으로 채운다. */
  @Test
  void 첫_보고는_SUBMITTED_를_WORKING_으로_이어_쓰고_도구를_채움() {
    makeExternal(agentId);
    addAgentAsAssignee();
    assertOk(putReport(akToken, TOOL, Map.of("note", "시작합니다")));
    assertThat(allStates(issueId, agentId)).containsExactly("WORKING");
    var w = activeWork(issueId, agentId).orElseThrow();
    assertThat(w.tool()).isEqualTo(TOOL);
    assertThat(w.note()).isEqualTo("시작합니다");
    assertThat(eventStates(issueId, agentId)).containsExactly("SUBMITTED", "WORKING");
  }

  /** MCP 쓰기(수행 도구 헤더)도 같은 행을 WORKING 으로 되돌리고 도구를 채운다. */
  @Test
  void MCP_쓰기는_SUBMITTED_를_WORKING_으로_이어_쓰고_도구를_채움() {
    makeExternal(agentId);
    addAgentAsAssignee();
    assertOk(patch(akToken, Map.of("title", "진행"), TOOL));
    assertThat(allStates(issueId, agentId)).containsExactly("WORKING");
    assertThat(activeWork(issueId, agentId).orElseThrow().tool()).isEqualTo(TOOL);
    assertThat(eventStates(issueId, agentId)).containsExactly("SUBMITTED", "WORKING");
  }

  /** 착수 전(SUBMITTED)에서 곧바로 종료 보고해도 행의 tool 이 요청 도구로 채워지고, 종료 이벤트는 한 건뿐이다. */
  @Test
  void SUBMITTED_에서_곧바로_종료_보고하면_tool_을_채우고_이벤트는_하나() {
    makeExternal(agentId);
    addAgentAsAssignee();
    assertOk(putReport(akToken, TOOL, Map.of("state", "REJECTED")));
    assertThat(allStates(issueId, agentId)).containsExactly("REJECTED");
    assertThat(eventStates(issueId, agentId)).containsExactly("SUBMITTED", "REJECTED");
    String tool =
        inTenant(
            () ->
                dsl.select(AGENT_WORK.TOOL)
                    .from(AGENT_WORK)
                    .where(AGENT_WORK.ISSUE_ID.eq(issueId))
                    .and(AGENT_WORK.WORKER_ID.eq(agentId))
                    .fetchOne(AGENT_WORK.TOOL));
    assertThat(tool).isEqualTo(TOOL);
  }

  /**
   * 사람이 도구 헤더로 자기를 담당자로 이슈를 만들어도 작업 행은 새로 열리지 않는다 — 생성 알림의 터치는 승격 전용이라, 시작도 안 한 TODO 이슈에 작업 중 행이 생겨
   * 2시간 뒤 무소식으로 보이는 일이 없다.
   */
  @Test
  void 사람이_도구_헤더로_자기를_담당자로_이슈를_만들면_행_없음() {
    long created = createIssue(patToken, TOOL, List.of(humanId));
    assertThat(allStates(created, humanId)).isEmpty();
    assertThat(eventStates(created, humanId)).isEmpty();
  }

  // ---------------------------------------------------------------- 실행 방식 전환

  /** 외부→내부로 바꾸면 영영 착수하지 않을 SUBMITTED 는 CANCELED(이벤트 포함), 일하던 WORKING 은 그대로. */
  @Test
  void 실행_방식을_내부로_바꾸면_SUBMITTED_만_CANCELED() {
    makeExternal(agentId);
    addAgentAsAssignee();
    long working = createIssue(akToken, TOOL, List.of(agentId));
    assertThat(activeWork(issueId, agentId).orElseThrow().state()).isEqualTo("SUBMITTED");

    inTenant(
        () -> {
          userService.setAgentRuntime(humanId, agentId, "INTERNAL");
          return null;
        });

    assertThat(allStates(issueId, agentId)).containsExactly("CANCELED");
    assertThat(eventStates(issueId, agentId)).containsExactly("SUBMITTED", "CANCELED");
    assertThat(activeWork(working, agentId).orElseThrow().state()).isEqualTo("WORKING");
  }

  /**
   * 내부→외부로 바꾸면 이미 담당자로 있는 열린 이슈마다 SUBMITTED 가 생긴다 — 이미 진행 중 작업이 있는 이슈·종료된 이슈·담당이 아닌 이슈는 제외. 이벤트도 한
   * 건씩.
   */
  @Test
  void 실행_방식을_외부로_바꾸면_담당_열린_이슈마다_SUBMITTED() {
    // agentId 는 기본 내부 실행 — 담당자로 들어가도 작업이 없다.
    addAgentAsAssignee();
    long open = createIssue(jwtToken, null, List.of(agentId));
    long closed = createIssue(jwtToken, null, List.of(agentId));
    long notAssigned = createIssue(jwtToken, null, List.of(humanId));
    long working = createIssue(jwtToken, null, List.of(agentId));
    inTenant(
        () -> dsl.update(ISSUE).set(ISSUE.STATUS, "DONE").where(ISSUE.ID.eq(closed)).execute());
    seedActive(working, agentId, "WORKING");
    assertThat(activeCount(issueId)).isZero();

    inTenant(
        () -> {
          userService.setAgentRuntime(humanId, agentId, "EXTERNAL");
          return null;
        });

    assertThat(activeWork(issueId, agentId).orElseThrow().state()).isEqualTo("SUBMITTED");
    assertThat(activeWork(open, agentId).orElseThrow().state()).isEqualTo("SUBMITTED");
    assertThat(eventStates(open, agentId)).containsExactly("SUBMITTED");
    assertThat(allStates(closed, agentId)).isEmpty();
    assertThat(allStates(notAssigned, agentId)).isEmpty();
    // 이미 일하던 이슈는 건드리지 않는다.
    assertThat(allStates(working, agentId)).containsExactly("WORKING");
  }

  /**
   * 같은 실행 방식으로의 변경 요청은 이벤트를 내지 않는다. 이벤트가 나갔다면 외부→외부는 담당 이슈에 SUBMITTED 를 만들고, 내부→내부는 시드한 SUBMITTED 를
   * 취소했을 것이다 — 둘 다 그대로임을 단언한다.
   */
  @Test
  void 같은_실행_방식으로_바꾸면_이벤트_없음() {
    // 내부로 담당자 추가 → 작업 없음. 그 뒤 외부로 바꿔 둔 상태에서 외부→외부 요청.
    addAgentAsAssignee();
    makeExternal(agentId);
    inTenant(
        () -> {
          userService.setAgentRuntime(humanId, agentId, "EXTERNAL");
          return null;
        });
    assertThat(allStates(issueId, agentId)).isEmpty();

    // 내부로 돌려 두고 SUBMITTED 를 시드한 뒤 내부→내부 요청.
    dsl.update(USER).set(USER.AGENT_RUNTIME, "INTERNAL").where(USER.ID.eq(agentId)).execute();
    seedSubmitted(issueId, agentId);
    inTenant(
        () -> {
          userService.setAgentRuntime(humanId, agentId, "INTERNAL");
          return null;
        });
    assertThat(activeWork(issueId, agentId).orElseThrow().state()).isEqualTo("SUBMITTED");
  }

  /** (b) 완료 보고 뒤 이슈를 DONE 으로 바꿔도 행은 하나(COMPLETED) — DONE 쓰기 터치가 새 작업 중 행·이벤트를 만들지 않는다. */
  @Test
  void b_완료_보고_뒤_DONE_이어도_행은_하나_COMPLETED() {
    makeExternal(agentId);
    addAgentAsAssignee();
    assertOk(putReport(akToken, TOOL, Map.of("note", "시작")));
    assertOk(putReport(akToken, TOOL, Map.of("state", "COMPLETED")));
    assertOk(patch(akToken, Map.of("status", "DONE"), TOOL));
    assertThat(allStates(issueId, agentId)).containsExactly("COMPLETED");
    assertThat(eventStates(issueId, agentId)).containsExactly("SUBMITTED", "WORKING", "COMPLETED");
  }

  /** 담당에서 빠지면 SUBMITTED 작업은 CANCELED 로 닫힌다. */
  @Test
  void 담당_해제하면_SUBMITTED_는_CANCELED() {
    makeExternal(agentId);
    addAgentAsAssignee();
    assertOk(putAssignees(jwtToken, List.of(humanId), null));
    assertThat(activeCount(issueId)).isZero();
    assertThat(allStates(issueId, agentId)).containsExactly("CANCELED");
    assertThat(eventStates(issueId, agentId)).containsExactly("SUBMITTED", "CANCELED");
  }

  /** (e) SUBMITTED 상태로 이슈가 DONE 이 되면 일한 적이 없으니 CANCELED. */
  @Test
  void e_SUBMITTED_로_이슈_DONE_이면_CANCELED() {
    makeExternal(agentId);
    addAgentAsAssignee();
    assertOk(patch(jwtToken, Map.of("status", "DONE"), null));
    assertThat(allStates(issueId, agentId)).containsExactly("CANCELED");
  }

  // ---------------------------------------------------------------- 목록

  /** 시작 전 작업도 AI 작업 목록·전체 건수에 잡히고, 진행 중 가운데 맨 뒤 순위이며 무소식(stale)이 아니다. */
  @Test
  void ai_tasks_목록에_시작전이_마지막_순위로_보이고_stale_아님() {
    makeExternal(agentId);
    var before = counts();
    // 작업 중인 이슈(시드 이슈의 사람 담당자)와 시작 전 이슈(외부 AI 담당)를 만든다.
    seedActive(issueId, humanId, "WORKING");
    long submitted = createIssue(jwtToken, null, List.of(agentId));

    var items = json(call(HttpMethod.GET, "/api/v1/me/ai-tasks?scope=ALL", jwtToken, null, null));
    int workingAt = -1;
    int submittedAt = -1;
    for (int i = 0; i < items.get("items").size(); i++) {
      long id = items.get("items").get(i).get("id").asLong();
      if (id == issueId) workingAt = i;
      if (id == submitted) {
        submittedAt = i;
        var work = items.get("items").get(i).at("/agentWork/0");
        assertThat(work.get("state").asText()).isEqualTo("SUBMITTED");
        assertThat(work.get("stale").asBoolean()).isFalse();
      }
    }
    assertThat(workingAt).isGreaterThanOrEqualTo(0);
    assertThat(submittedAt).isGreaterThan(workingAt);
    // 시작 전은 전체에만 든다 — 전체는 작업 중 시드와 시작 전 둘만큼 늘고, 칩은 작업 중 시드 하나만 세며 시작 전 이슈는 어느 칩도 올리지 않는다.
    var after = counts();
    assertThat(after.get("all").asLong()).isEqualTo(before.get("all").asLong() + 2);
    assertThat(after.get("working").asLong()).isEqualTo(before.get("working").asLong() + 1);
    for (String chip : List.of("inputRequired", "review", "blocked")) {
      assertThat(after.get(chip).asLong()).as(chip).isEqualTo(before.get(chip).asLong());
    }
  }

  /** AI 작업 건수(scope=ALL) — all·inputRequired·review·blocked·working. */
  private JsonNode counts() {
    return json(call(HttpMethod.GET, "/api/v1/me/ai-tasks/counts?scope=ALL", jwtToken, null, null));
  }
}
