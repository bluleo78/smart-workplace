package com.workplace.issue;

import static com.workplace.jooq.Tables.ISSUE;
import static com.workplace.jooq.Tables.ISSUE_HISTORY;
import static com.workplace.jooq.Tables.PROJECT_STATUS;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.issue.dto.CreateIssueRequest;
import com.workplace.issue.dto.CreateProjectStatusRequest;
import com.workplace.issue.service.ProjectStatusService;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpMethod;

/**
 * MCP(수행 도구 헤더) 쓰기는 AI 작업을 시작하지 않고 이슈 상태도 진행 중으로 올리지 않는다(WP-1365 — WP-393 의 자동 시작을 걷어냄). 할 일 이슈의
 * 본문을 고치거나 파일을 붙이거나 상태를 할 일로 되돌리기만 해도 작업 행이 생기고 이슈가 진행 중으로 올라가던 증상의 회귀 테스트다. 사람·AI 담당자 모두 같은 규칙이고,
 * 작업 시작과 진행 중 올리기는 명시 보고(report_agent_work)로만 한다.
 */
class AgentWorkIssueStatusTest extends AgentWorkTestSupport {

  @Autowired ProjectStatusService projectStatusService;

  // ---------------------------------------------------------------- 증상 다섯 경우

  /** 증상 1: 할 일 이슈 본문 수정(update_issue body) — 사람·AI 담당자 모두 이슈는 할 일, 작업 행·상태 이력 없음. */
  @Test
  void 할일_이슈_본문_수정은_작업도_상태도_그대로() {
    assertOk(patch(patToken, Map.of("body", "본문 고침"), TOOL));
    assertOk(patch(akToken, Map.of("body", "본문 또 고침"), TOOL));
    assertThat(issueStatus()).isEqualTo("TODO");
    assertThat(activeCount(issueId)).isZero();
    assertThat(historyTypes(issueId)).doesNotContain("STATUS_CHANGED");
  }

  /** 증상 2: 할 일 이슈에 파일 첨부(fileIds → 첨부 클레임) — 이슈는 할 일, 작업 행 없음. */
  @Test
  void 할일_이슈_첨부는_작업도_상태도_그대로() {
    // 스테이징 파일은 올린 사람만 클레임할 수 있어 사람·AI 가 각자 올려 붙인다.
    for (String token : List.of(patToken, akToken)) {
      long fileId = stageText(token, "attach.txt");
      assertOk(
          call(
              HttpMethod.POST,
              issuePath() + "/attachments/claim",
              token,
              Map.of("fileIds", List.of(fileId)),
              TOOL));
    }
    assertThat(issueStatus()).isEqualTo("TODO");
    assertThat(activeCount(issueId)).isZero();
  }

  /** 증상 3: 진행 중 이슈를 도구 헤더로 status=TODO 로 되돌려도 작업 행이 생기지 않는다. */
  @Test
  void 상태를_할일로_지정한_쓰기는_작업을_만들지_않음() {
    assertOk(patch(jwtToken, Map.of("status", "IN_PROGRESS"), null));
    assertOk(patch(patToken, Map.of("status", "TODO"), TOOL));
    assertThat(activeCount(issueId)).isZero();
    assertThat(issueStatus()).isEqualTo("TODO");
    assertThat(statusHistory(issueId)).containsExactly("할 일→진행 중", "진행 중→할 일");
  }

  /** 증상 4: 맡은 AI 가 없는(사람 담당만) 진행 중 이슈를 사람 담당자가 도구 헤더로 할 일로 되돌려도 작업 행이 없다. */
  @Test
  void 사람만_담당한_진행중_이슈를_할일로_되돌려도_작업_없음() {
    assertOk(putAssignees(jwtToken, List.of(humanId), null));
    assertOk(patch(jwtToken, Map.of("status", "IN_PROGRESS"), null));
    assertOk(patch(patToken, Map.of("status", "TODO"), TOOL));
    assertThat(activeCount(issueId)).isZero();
    assertThat(allStates(issueId, humanId)).isEmpty();
    assertThat(issueStatus()).isEqualTo("TODO");
  }

  /**
   * 증상 5: 라벨 추가·차단 관계 추가(정리성 쓰기, WP-425)는 지금처럼 아무것도 바꾸지 않는다 — 새 작업도 없고, 이미 있는 일시 중지 작업도 되돌리지 않는다
   * (터치하지 않음). 일하던 작업을 먼저 두어야 이 쓰기가 터치 경로(updated)로 바뀌었을 때 잡힌다.
   */
  @Test
  void 라벨_차단관계_추가는_작업도_상태도_그대로() {
    seedActive(issueId, agentId, "PAUSED");
    int other =
        inTenant(
            () ->
                issueService
                    .create(
                        humanId,
                        projectKey,
                        new CreateIssueRequest(
                            "차단 대상", "본문", "MID", null, List.of(), null, null, null))
                    .number());
    assertOk(
        call(
            HttpMethod.PUT,
            issuePath() + "/labels",
            akToken,
            Map.of("labelIds", List.of(), "labelNames", List.of("정리")),
            TOOL));
    assertOk(
        call(
            HttpMethod.POST,
            issuePath() + "/dependencies",
            akToken,
            Map.of("otherNumber", other, "direction", "blocks"),
            TOOL));
    assertThat(activeWork(issueId, agentId).orElseThrow().state()).isEqualTo("PAUSED");
    assertThat(activeWork(issueId, humanId)).isEmpty();
    assertThat(issueStatus()).isEqualTo("TODO");
  }

  // ---------------------------------------------------------------- 그 밖의 규칙

  /** 상태를 진행 중으로 직접 지정한 쓰기 — 이슈 상태만 진행 중이 되고 작업 행은 없다. */
  @Test
  void 상태를_진행중으로_지정해도_작업은_만들지_않음() {
    assertOk(patch(akToken, Map.of("status", "IN_PROGRESS"), TOOL));
    assertThat(issueStatus()).isEqualTo("IN_PROGRESS");
    assertThat(activeCount(issueId)).isZero();
  }

  /** 코멘트도 할 일 이슈를 진행 중으로 올리지 않는다. */
  @Test
  void 코멘트는_할일_이슈를_올리지_않음() {
    assertOk(postComment(akToken, "착수합니다", TOOL));
    assertThat(issueStatus()).isEqualTo("TODO");
    assertThat(activeCount(issueId)).isZero();
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

  /** 시작 전 작업이 있는 할 일 이슈에 MCP 쓰기를 해도 작업은 시작 전, 이슈는 할 일 그대로. */
  @Test
  void 시작_전_작업이_있어도_MCP_쓰기는_TODO_유지() {
    seedSubmitted(issueId, agentId);
    assertOk(patch(akToken, Map.of("title", "진행"), TOOL));
    assertThat(activeWork(issueId, agentId).orElseThrow().state()).isEqualTo("SUBMITTED");
    assertThat(issueStatus()).isEqualTo("TODO");
  }

  /** 외부 AI 가 자기를 담당자로 이슈를 만들면 작업은 시작 전으로 남고 이슈는 응답·저장 모두 할 일. */
  @Test
  void 외부_AI가_자기를_담당자로_이슈를_만들면_시작전_TODO() {
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
    assertThat(json(res).get("status").asText()).isEqualTo("TODO");
    assertThat(statusOf(created)).isEqualTo("TODO");
    assertThat(activeWork(created, agentId).orElseThrow().state()).isEqualTo("SUBMITTED");
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
  void statusName만_보낸_수정은_그_상태가_되고_작업을_만들지_않음() {
    // 할 일 범주의 사용자 정의 상태를 이름으로 지정(WP-870) — 그 상태가 되고 작업은 생기지 않는다.
    inTenant(
        () ->
            projectStatusService.create(
                humanId, projectKey, new CreateProjectStatusRequest("대기", "TODO", null, null)));
    assertOk(patch(jwtToken, Map.of("status", "IN_PROGRESS"), null));
    assertOk(patch(patToken, Map.of("statusName", "대기"), TOOL));
    assertThat(activeWork(issueId, humanId)).isEmpty();
    assertThat(issueStatusName()).isEqualTo("대기");
  }

  @Test
  void 도구_헤더_없는_쓰기는_상태를_바꾸지_않음() {
    assertOk(patch(patToken, Map.of("title", "진행"), null));
    assertThat(issueStatus()).isEqualTo("TODO");
  }

  // ---------------------------------------------------------------- 명시 보고(작업 시작 경로)

  /** 작업 시작은 명시 보고로 — 할 일 이슈는 진행 중(기본 상태)으로, 이력 한 건과 작업 이벤트 한 건(WP-393 규칙 유지). */
  @Test
  void 명시_보고로_시작하면_TODO_이슈는_진행중_기본상태로() {
    addInProgressStatus("검토 중");
    assertOk(putReport(akToken, TOOL, Map.of("state", "WORKING", "note", "착수")));
    assertThat(issueStatus()).isEqualTo("IN_PROGRESS");
    assertThat(issueStatusName()).isEqualTo("진행 중");
    assertThat(statusHistory(issueId)).containsExactly("할 일→진행 중");
    assertThat(eventStates(issueId, agentId)).containsExactly("WORKING");
  }

  @Test
  void AI작업_시작은_검토중_이슈를_되돌리지_않는다() {
    long review = addInProgressStatus("검토 중");
    assertOk(patch(jwtToken, Map.of("statusId", review), null));
    // 진행 중 범주의 사용자 정의 상태에서 작업 보고가 시작돼도 「진행 중」 기본 상태로 되돌리지 않는다(WP-807).
    assertOk(putReport(akToken, TOOL, Map.of("state", "WORKING", "message", "착수")));
    assertThat(issueStatusName()).isEqualTo("검토 중");
  }

  /** 진행 중 범주 끝에 사용자 정의 상태를 하나 더한다(기본 상태 「진행 중」은 그대로 맨 앞). */
  private long addInProgressStatus(String name) {
    return inTenant(
        () ->
            projectStatusService
                .create(
                    humanId,
                    projectKey,
                    new CreateProjectStatusRequest(name, "IN_PROGRESS", null, null))
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
