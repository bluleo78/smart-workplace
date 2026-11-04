package com.workplace.issue;

import static com.workplace.jooq.Tables.AGENT_WORK;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.global.security.AgentToolContext;
import com.workplace.issue.dto.AgentWorkView;
import com.workplace.issue.dto.CreateIssueRequest;
import com.workplace.issue.dto.UpdateIssueRequest;
import com.workplace.issue.service.AgentWorkService;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpMethod;

/**
 * MCP(수행 도구 헤더) 경유 이슈 쓰기 → 이미 있는 AI 작업의 터치·상태 복귀(WP-377, 스펙 §4.2). 쓰기는 작업을 시작하지 않는다(WP-1365) — 작업
 * 행이 없으면 만들지 않고, 행을 만드는 것은 명시 보고(report_agent_work)다. PAT·ak_·JWT 로 실제 HTTP 요청을 보내 인증 필터가 헤더를 채택하는
 * 경로까지 검증한다. "안 만듦" 단언은 요청 자체가 성공(2xx)했는지 먼저 확인해 거절로 인한 거짓 통과를 막는다.
 */
class AgentWorkToolWriteTest extends AgentWorkTestSupport {

  @Autowired private AgentWorkService agentWorkService;

  /** WP-1365: 담당자의 도구 헤더 쓰기라도 작업이 없으면 새로 만들지 않는다 — 사람 담당자(PAT). */
  @Test
  void PAT_헤더있는_쓰기도_작업이_없으면_만들지_않음() {
    assertOk(patch(patToken, Map.of("title", "진행"), TOOL));
    assertThat(activeWork(issueId, humanId)).isEmpty();
    assertThat(allStates(issueId, humanId)).isEmpty();
  }

  /** WP-1365: 코멘트도 작업을 시작하지 않는다. */
  @Test
  void 코멘트_작성도_작업을_시작하지_않음() {
    assertOk(postComment(patToken, "진행 메모", TOOL));
    assertOk(postComment(akToken, "착수합니다", TOOL));
    assertThat(activeCount(issueId)).isZero();
  }

  /** 명시 보고로 만든 작업은 이후의 MCP 쓰기가 같은 행의 도구·updated_at 을 터치한다(새 행 없음). */
  @Test
  void 보고로_시작한_작업은_MCP_쓰기가_같은_행을_터치() {
    assertOk(putReport(patToken, TOOL, Map.of("state", "WORKING", "note", "착수")));
    var reported = activeWork(issueId, humanId).orElseThrow();
    assertOk(patch(patToken, Map.of("body", "진행 메모"), "cursor"));
    var w = activeWork(issueId, humanId).orElseThrow();
    assertThat(w.id()).isEqualTo(reported.id());
    assertThat(w.state()).isEqualTo("WORKING");
    assertThat(w.tool()).isEqualTo("cursor");
    assertThat(w.note()).isEqualTo("착수");
    assertThat(allStates(issueId, humanId)).containsExactly("WORKING");
  }

  /** 명시 보고로 답변 필요가 된 작업은 MCP 쓰기(코멘트)로 다시 움직이면 작업 중으로 돌아오고 질문 note 를 지운다. */
  @Test
  void 보고로_답변필요가_된_작업은_코멘트로_작업중_복귀() {
    assertOk(putReport(akToken, TOOL, Map.of("state", "INPUT_REQUIRED", "note", "어느 쪽?")));
    assertOk(postComment(akToken, "확인했습니다, 이어서 합니다", TOOL));
    var w = activeWork(issueId, agentId).orElseThrow();
    assertThat(w.state()).isEqualTo("WORKING");
    assertThat(w.note()).isNull();
  }

  @Test
  void 헤더없는_PAT_쓰기는_안만듦() {
    assertOk(patch(patToken, Map.of("title", "진행"), null));
    assertThat(activeWork(issueId, humanId)).isEmpty();
  }

  @Test
  void JWT_에_헤더가_있어도_안만듦() {
    assertOk(patch(jwtToken, Map.of("title", "진행"), TOOL));
    assertThat(activeWork(issueId, humanId)).isEmpty();
  }

  @Test
  void 담당자가_아니면_안만듦() {
    assertOk(patch(otherPatToken, Map.of("title", "진행"), TOOL));
    assertThat(activeWork(issueId, otherId)).isEmpty();
    assertThat(activeCount(issueId)).isZero();
  }

  @Test
  void 읽기는_안만듦() {
    assertOk(get(patToken, TOOL));
    assertThat(activeWork(issueId, humanId)).isEmpty();
  }

  /** WP-1365: AI 담당자(ak_)도 사람과 같은 규칙 — 쓰기만으로 작업이 생기지 않는다. */
  @Test
  void ak_쓰기도_작업을_만들지_않음() {
    assertOk(patch(akToken, Map.of("title", "진행"), TOOL));
    assertThat(activeCount(issueId)).isZero();
  }

  /** 터치는 쓴 사람의 작업만 — 같은 이슈의 다른 담당자 작업은 건드리지 않는다. */
  @Test
  void ak_쓰기는_다른_담당자_작업을_터치하지_않음() {
    seedActive(issueId, humanId, "PAUSED");
    seedActive(issueId, agentId, "PAUSED");
    assertOk(patch(akToken, Map.of("title", "진행"), TOOL));
    assertThat(activeWork(issueId, agentId).orElseThrow().state()).isEqualTo("WORKING");
    assertThat(activeWork(issueId, humanId).orElseThrow().state()).isEqualTo("PAUSED");
  }

  @Test
  void 종료된_이슈에는_안만듦() {
    assertOk(patch(patToken, Map.of("status", "DONE"), null));
    assertOk(postComment(patToken, "완료 후 메모", TOOL));
    assertThat(activeWork(issueId, humanId)).isEmpty();
  }

  @Test
  void 상태복귀_답변인증필요_막힘_일시중지는_WORKING_REVIEW_는_유지() {
    for (String s : List.of("INPUT_REQUIRED", "AUTH_REQUIRED", "BLOCKED", "PAUSED", "REVIEW")) {
      seedActive(issueId, humanId, s);
      assertOk(patch(patToken, Map.of("title", "진행"), "cursor"));
      var w = activeWork(issueId, humanId).orElseThrow();
      assertThat(w.state()).as(s).isEqualTo(s.equals("REVIEW") ? "REVIEW" : "WORKING");
      // 수행 도구는 최신 요청 값으로 덮는다.
      assertThat(w.tool()).as(s).isEqualTo("cursor");
    }
    assertThat(activeCount(issueId)).isEqualTo(1);
  }

  /** WP-1365: 시작 전(SUBMITTED) 작업은 MCP 쓰기로 잇지 않는다 — 상태도 도구(null)도 그대로. */
  @Test
  void 시작전_작업은_MCP_쓰기로_잇지_않음() {
    seedSubmitted(issueId, agentId);
    assertOk(patch(akToken, Map.of("title", "진행"), TOOL));
    assertOk(postComment(akToken, "메모", TOOL));
    var w = activeWork(issueId, agentId).orElseThrow();
    assertThat(w.state()).isEqualTo("SUBMITTED");
    assertThat(w.tool()).isNull();
    assertThat(eventStates(issueId, agentId)).containsExactly("SUBMITTED");
    assertThat(issueStatus()).isEqualTo("TODO");
  }

  /** WP-450: 다음 회차 대기(SCHEDULED)는 이슈 쓰기로 작업 중으로 되돌리지 않는다 — 상태와 다음 실행 시각 모두 그대로, tool 만 갱신. */
  @Test
  void SCHEDULED_는_MCP_쓰기에도_상태와_시각을_유지() {
    seedActive(issueId, humanId, "SCHEDULED");
    var next = OffsetDateTime.parse("2026-10-19T09:00:00+09:00");
    inTenant(
        () ->
            dsl.update(AGENT_WORK)
                .set(AGENT_WORK.NEXT_RUN_AT, next)
                .where(AGENT_WORK.ISSUE_ID.eq(issueId))
                .and(AGENT_WORK.WORKER_ID.eq(humanId))
                .execute());
    assertOk(patch(patToken, Map.of("title", "진행"), "cursor"));
    var w = activeWork(issueId, humanId).orElseThrow();
    assertThat(w.state()).isEqualTo("SCHEDULED");
    assertThat(w.nextRunAt()).isEqualTo(next.toInstant());
    assertThat(w.tool()).isEqualTo("cursor");
  }

  /**
   * WP-1024: 대기 중(WAITING)도 이슈 쓰기로 작업 중으로 되돌리지 않는다 — 상대를 기다리는 사이의 쓰기(답·PR 링크)로 무엇을 기다리는지가 사라지지 않게.
   */
  @Test
  void waiting_keepsState_onMcpWrite() {
    seedActive(issueId, humanId, "WAITING");
    assertOk(patch(patToken, Map.of("title", "진행"), "cursor"));
    var w = activeWork(issueId, humanId).orElseThrow();
    assertThat(w.state()).isEqualTo("WAITING");
    assertThat(w.tool()).isEqualTo("cursor");
  }

  @Test
  void 경고없는_쓰기는_updated_at_갱신() {
    var seeded = OffsetDateTime.now().minusHours(3);
    seedActive(issueId, humanId, "WORKING", seeded);
    assertOk(patch(patToken, Map.of("title", "진행"), TOOL));
    // 실시간 데드라인 대신 "시드 시각보다 뒤로 움직였고, 무소식이 풀렸다" 로만 본다(부하에서도 결정적).
    var w = activeView(issueId, humanId);
    assertThat(w.updatedAt()).isAfter(seeded.toInstant());
    assertThat(w.stale()).isFalse();
    assertThat(activeCount(issueId)).isEqualTo(1);
  }

  /** 워치 등록·해제는 이슈 작업이 아니다 — MCP(수행 도구 헤더) 경유라도 담당자의 AI 작업을 만들지 않는다. */
  @Test
  void 워치_등록_해제는_작업을_만들지_않음() {
    // 사람 담당자는 이슈 작성자라 이미 워처일 수 있어(등록이 no-op) 해제 → 등록 순으로 두 경로를 모두 지난다.
    assertOk(call(HttpMethod.DELETE, issuePath() + "/watch", patToken, null, TOOL));
    assertOk(call(HttpMethod.POST, issuePath() + "/watch", patToken, null, TOOL));
    assertThat(activeWork(issueId, humanId)).isEmpty();
  }

  /** 의존성 추가는 정리성 쓰기라(WP-425) 호출자가 쓴 이슈(A)도, 링크로 화면만 바뀐 상대 이슈(B)도 담당자의 작업을 만들지 않는다. */
  @Test
  void 의존성_추가는_어느_이슈에도_작업을_만들지_않음() {
    var other =
        inTenant(
            () -> {
              var b =
                  issueService.create(
                      humanId,
                      projectKey,
                      new CreateIssueRequest(
                          "차단 대상", "본문", "MID", null, List.of(), null, null, null));
              issueAssigneeRepository.add(b.id(), humanId, humanId);
              return b;
            });
    assertOk(
        call(
            HttpMethod.POST,
            issuePath() + "/dependencies",
            patToken,
            Map.of("otherNumber", other.number(), "direction", "blocks"),
            TOOL));
    assertThat(activeWork(issueId, humanId)).isEmpty();
    assertThat(activeWork(other.id(), humanId)).isEmpty();
  }

  /** (이슈, 작업자)의 진행 중 작업 뷰(무소식 판정 포함). */
  private AgentWorkView activeView(long issueId, long workerId) {
    return inTenant(() -> agentWorkService.viewsByIssueIds(List.of(issueId)))
        .getOrDefault(issueId, List.of())
        .stream()
        .filter(v -> v.worker().id() == workerId)
        .findFirst()
        .orElseThrow();
  }

  /**
   * 명시 보고 처리 중 부수 쓰기(상태 변경 등)는 suppressTouch 로 감싸 터치하지 않는다 — 보고한 INPUT_REQUIRED 이 되돌려지지 않게. 리스너가
   * 동기라 요청 밖 서비스 호출로 검증하고, 같은 호출을 억제 없이 한 번 더 해 경로가 실제로 터치함을 대조한다.
   */
  @Test
  void 터치_억제_중_쓰기는_상태를_되돌리지_않음() {
    seedActive(issueId, humanId, "INPUT_REQUIRED");
    var req =
        new UpdateIssueRequest(
            "진행", null, null, null, null, null, null, null, null, null, null, null, null);
    AgentToolContext.set(TOOL);
    try {
      inTenant(
          () ->
              AgentToolContext.suppressTouch(
                  () -> issueService.update(humanId, projectKey, issueNumber, req)));
      assertThat(activeWork(issueId, humanId).orElseThrow().state()).isEqualTo("INPUT_REQUIRED");

      inTenant(() -> issueService.update(humanId, projectKey, issueNumber, req));
      assertThat(activeWork(issueId, humanId).orElseThrow().state()).isEqualTo("WORKING");
    } finally {
      AgentToolContext.clear();
    }
  }
}
