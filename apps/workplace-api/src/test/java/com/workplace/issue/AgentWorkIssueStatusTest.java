package com.workplace.issue;

import static com.workplace.jooq.Tables.ISSUE;
import static com.workplace.jooq.Tables.ISSUE_HISTORY;
import static com.workplace.jooq.Tables.PROJECT_STATUS;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.issue.dto.CreateProjectStatusRequest;
import com.workplace.issue.service.ProjectStatusService;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpMethod;

/**
 * MCP(수행 도구 헤더) 쓰기로 AI 작업이 자동 시작되면 할 일(TODO) 이슈가 진행 중으로 바뀌는지(WP-393). 명시 보고와 같은 규칙 — 이력 한 건과 작업
 * 이벤트는 늘지 않아야 하고, 시작이 아닌 터치(이미 일하던 작업)·사람이 담당만 맡긴 시작 전 작업은 상태를 바꾸지 않는다.
 */
class AgentWorkIssueStatusTest extends AgentWorkTestSupport {

  @Autowired ProjectStatusService projectStatusService;

  @Test
  void 도구_헤더_쓰기로_작업이_시작되면_TODO_이슈는_진행_중_이력_하나_작업_이벤트도_하나() {
    assertOk(patch(patToken, Map.of("title", "진행"), TOOL));
    assertThat(issueStatus()).isEqualTo("IN_PROGRESS");
    assertThat(statusHistory(issueId)).containsExactly("할 일→진행 중");
    // 상태 변경 알림이 다시 터치를 일으켜 작업 이벤트를 한 번 더 남기지 않는다.
    assertThat(eventStates(issueId, humanId)).containsExactly("WORKING");
  }

  @Test
  void 코멘트로_시작해도_진행_중() {
    assertOk(postComment(akToken, "착수합니다", TOOL));
    assertThat(issueStatus()).isEqualTo("IN_PROGRESS");
    assertThat(eventStates(issueId, agentId)).containsExactly("WORKING");
  }

  @Test
  void 사람이_외부_AI를_담당자로만_두면_TODO_유지() {
    assertOk(putAssignees(jwtToken, List.of(humanId), null));
    makeExternal(agentId);
    assertOk(putAssignees(jwtToken, List.of(humanId, agentId), null));
    assertThat(activeWork(issueId, agentId).orElseThrow().state()).isEqualTo("SUBMITTED");
    assertThat(issueStatus()).isEqualTo("TODO");
    assertThat(statusHistory(issueId)).isEmpty();
  }

  @Test
  void 시작_전_작업을_MCP_쓰기로_이으면_진행_중() {
    seedSubmitted(issueId, agentId);
    assertOk(patch(akToken, Map.of("title", "진행"), TOOL));
    assertThat(activeWork(issueId, agentId).orElseThrow().state()).isEqualTo("WORKING");
    assertThat(issueStatus()).isEqualTo("IN_PROGRESS");
  }

  @Test
  void 외부_AI가_자기를_담당자로_이슈를_만들면_응답과_저장_상태가_진행_중() {
    makeExternal(agentId);
    var res =
        call(
            HttpMethod.POST,
            "/api/v1/projects/" + projectKey + "/issues",
            akToken,
            Map.of("title", "AI 가 만든 이슈", "assigneeIds", List.of(agentId)),
            TOOL);
    assertOk(res);
    long created = json(res).get("id").asLong();
    // 응답이 저장 값과 어긋나면(MCP create_issue 가 TODO 로 오판) 안 된다.
    assertThat(json(res).get("status").asText()).isEqualTo("IN_PROGRESS");
    assertThat(statusOf(created)).isEqualTo("IN_PROGRESS");
  }

  @Test
  void 이미_일하던_작업의_터치는_사람이_되돌린_TODO_를_바꾸지_않음() {
    seedActive(issueId, humanId, "WORKING");
    assertOk(patch(patToken, Map.of("title", "진행"), TOOL));
    assertThat(issueStatus()).isEqualTo("TODO");
  }

  @Test
  void 이미_진행_중이면_이력을_더_남기지_않음() {
    assertOk(patch(jwtToken, Map.of("status", "IN_PROGRESS"), null));
    assertOk(patch(patToken, Map.of("title", "진행"), TOOL));
    assertThat(statusHistory(issueId)).containsExactly("할 일→진행 중");
  }

  @Test
  void 상태를_직접_할_일로_지정한_쓰기는_작업이_시작돼도_덮지_않음() {
    assertOk(patch(jwtToken, Map.of("status", "IN_PROGRESS"), null));
    // 일하던 작업이 없어 이 쓰기로 작업이 새로 시작되지만, 요청한 상태(TODO)가 우선이다.
    assertOk(patch(patToken, Map.of("status", "TODO"), TOOL));
    assertThat(activeWork(issueId, humanId).orElseThrow().state()).isEqualTo("WORKING");
    assertThat(issueStatus()).isEqualTo("TODO");
    assertThat(statusHistory(issueId)).containsExactly("할 일→진행 중", "진행 중→할 일");
  }

  @Test
  void 자동_시작의_상태_이력은_그것을_일으킨_변경_뒤에_남는다() {
    assertOk(patch(patToken, Map.of("title", "진행"), TOOL));
    assertThat(historyTypes(issueId)).containsExactly("TITLE_CHANGED", "STATUS_CHANGED");
  }

  @Test
  void 도구_헤더_없는_쓰기는_상태를_바꾸지_않음() {
    assertOk(patch(patToken, Map.of("title", "진행"), null));
    assertThat(issueStatus()).isEqualTo("TODO");
  }

  @Test
  void AI작업_시작은_검토중_이슈를_되돌리지_않는다() {
    long review = addInProgressStatus("검토 중");
    assertOk(patch(jwtToken, Map.of("statusId", review), null));
    // 진행 중 범주의 사용자 정의 상태에서 작업 보고가 시작돼도 「진행 중」 기본 상태로 되돌리지 않는다(WP-807).
    assertOk(putReport(akToken, TOOL, Map.of("state", "WORKING", "message", "착수")));
    assertThat(issueStatusName()).isEqualTo("검토 중");
  }

  @Test
  void AI작업_자동시작은_TODO이슈를_진행중_기본상태로() {
    addInProgressStatus("검토 중");
    assertOk(patch(patToken, Map.of("title", "진행"), TOOL));
    assertThat(issueStatus()).isEqualTo("IN_PROGRESS");
    assertThat(issueStatusName()).isEqualTo("진행 중");
  }

  /** 진행 중 범주 끝에 사용자 정의 상태를 하나 더한다(기본 상태 「진행 중」은 그대로 맨 앞). */
  private long addInProgressStatus(String name) {
    return inTenant(
        () ->
            projectStatusService
                .create(
                    humanId, projectKey, new CreateProjectStatusRequest(name, "IN_PROGRESS", null))
                .id());
  }

  /** 이슈의 지금 상태 이름. */
  private String issueStatusName() {
    return inTenant(
        () ->
            dsl.select(PROJECT_STATUS.NAME)
                .from(ISSUE)
                .join(PROJECT_STATUS)
                .on(PROJECT_STATUS.ID.eq(ISSUE.STATUS_ID))
                .where(ISSUE.ID.eq(issueId))
                .fetchOne(PROJECT_STATUS.NAME));
  }

  /** 이슈의 상태 변경 이력을 "이전→이후"(그 시점 상태 이름, WP-807) 로 시간순. */
  private List<String> statusHistory(long id) {
    return inTenant(
        () ->
            dsl.select(ISSUE_HISTORY.FROM_VALUE, ISSUE_HISTORY.TO_VALUE)
                .from(ISSUE_HISTORY)
                .where(ISSUE_HISTORY.ISSUE_ID.eq(id))
                .and(ISSUE_HISTORY.EVENT_TYPE.eq("STATUS_CHANGED"))
                .orderBy(ISSUE_HISTORY.ID.asc())
                .fetch(r -> r.value1() + "→" + r.value2()));
  }

  /** 이슈의 변경 이력 종류를 시간순으로. */
  private List<String> historyTypes(long id) {
    return inTenant(
        () ->
            dsl.select(ISSUE_HISTORY.EVENT_TYPE)
                .from(ISSUE_HISTORY)
                .where(ISSUE_HISTORY.ISSUE_ID.eq(id))
                .orderBy(ISSUE_HISTORY.ID.asc())
                .fetch(ISSUE_HISTORY.EVENT_TYPE));
  }

  /** 지정 이슈의 저장된 상태. */
  private String statusOf(long id) {
    return inTenant(
        () -> dsl.select(ISSUE.STATUS).from(ISSUE).where(ISSUE.ID.eq(id)).fetchOne(ISSUE.STATUS));
  }
}
