package com.workplace.issue;

import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.global.security.AgentToolContext;
import com.workplace.issue.dto.UpdateIssueRequest;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.http.ResponseEntity;

/**
 * MCP(수행 도구 헤더) 경유 이슈 쓰기 → AI 작업 자동 시작·상태 복귀(WP-377, 스펙 §4.2). PAT·ak_·JWT 로 실제 HTTP 요청을 보내 인증 필터가
 * 헤더를 채택하는 경로까지 검증한다. "안 만듦" 단언은 요청 자체가 성공(2xx)했는지 먼저 확인해 거절로 인한 거짓 통과를 막는다.
 */
class AgentWorkAutoStartTest extends AgentWorkTestSupport {

  /** 요청이 성공했는지 — 실패 응답이면 본문을 메시지로 보여준다. */
  private static void assertOk(ResponseEntity<String> res) {
    assertThat(res.getStatusCode().is2xxSuccessful()).as(res.getBody()).isTrue();
  }

  @Test
  void PAT_헤더있는_쓰기_담당자면_WORKING_생성() {
    assertOk(patch(patToken, Map.of("priority", "HIGH"), TOOL));
    assertThat(activeWork(issueId, humanId))
        .hasValueSatisfying(
            w -> {
              assertThat(w.state()).isEqualTo("WORKING");
              assertThat(w.tool()).isEqualTo(TOOL);
            });
  }

  @Test
  void 코멘트_작성도_자동시작() {
    assertOk(postComment(patToken, "진행 메모", TOOL));
    assertThat(activeWork(issueId, humanId)).isPresent();
  }

  @Test
  void 헤더없는_PAT_쓰기는_안만듦() {
    assertOk(patch(patToken, Map.of("priority", "HIGH"), null));
    assertThat(activeWork(issueId, humanId)).isEmpty();
  }

  @Test
  void JWT_에_헤더가_있어도_안만듦() {
    assertOk(patch(jwtToken, Map.of("priority", "HIGH"), TOOL));
    assertThat(activeWork(issueId, humanId)).isEmpty();
  }

  @Test
  void 담당자가_아니면_안만듦() {
    assertOk(patch(otherPatToken, Map.of("priority", "HIGH"), TOOL));
    assertThat(activeWork(issueId, otherId)).isEmpty();
    assertThat(activeCount(issueId)).isZero();
  }

  @Test
  void 읽기는_안만듦() {
    assertOk(get(patToken, TOOL));
    assertThat(activeWork(issueId, humanId)).isEmpty();
  }

  @Test
  void ak_쓰기도_자동시작() {
    assertOk(patch(akToken, Map.of("priority", "LOW"), TOOL));
    assertThat(activeWork(issueId, agentId))
        .hasValueSatisfying(w -> assertThat(w.state()).isEqualTo("WORKING"));
    // 쓴 사람(AI 구성원)만 — 같은 이슈의 다른 담당자 작업은 만들지 않는다.
    assertThat(activeWork(issueId, humanId)).isEmpty();
  }

  @Test
  void 종료된_이슈에는_안만듦() {
    assertOk(patch(patToken, Map.of("status", "DONE"), null));
    assertOk(postComment(patToken, "완료 후 메모", TOOL));
    assertThat(activeWork(issueId, humanId)).isEmpty();
  }

  @Test
  void 상태복귀_WAITING_BLOCKED_PAUSED_는_WORKING_REVIEW_는_유지() {
    for (String s : List.of("WAITING", "BLOCKED", "PAUSED", "REVIEW")) {
      seedActive(issueId, humanId, s);
      assertOk(patch(patToken, Map.of("priority", "HIGH"), "cursor"));
      var w = activeWork(issueId, humanId).orElseThrow();
      assertThat(w.state()).as(s).isEqualTo(s.equals("REVIEW") ? "REVIEW" : "WORKING");
      // 수행 도구는 최신 요청 값으로 덮는다.
      assertThat(w.tool()).as(s).isEqualTo("cursor");
    }
    assertThat(activeCount(issueId)).isEqualTo(1);
  }

  @Test
  void 경고없는_쓰기는_updated_at_갱신() {
    seedActive(issueId, humanId, "WORKING", OffsetDateTime.now().minusHours(3));
    assertOk(patch(patToken, Map.of("priority", "HIGH"), TOOL));
    var w = activeWork(issueId, humanId).orElseThrow();
    // 무소식(2시간) 기준 밖으로 — 방금 갱신됐다.
    assertThat(w.updatedAt()).isAfter(Instant.now().minus(1, ChronoUnit.MINUTES));
    assertThat(activeCount(issueId)).isEqualTo(1);
  }

  /**
   * 명시 보고 처리 중 부수 쓰기(상태 변경 등)는 suppressTouch 로 감싸 터치하지 않는다 — 보고한 WAITING 이 되돌려지지 않게. 리스너가 동기라 요청 밖
   * 서비스 호출로 검증하고, 같은 호출을 억제 없이 한 번 더 해 경로가 실제로 터치함을 대조한다.
   */
  @Test
  void 터치_억제_중_쓰기는_상태를_되돌리지_않음() {
    seedActive(issueId, humanId, "WAITING");
    var req =
        new UpdateIssueRequest(null, null, null, "HIGH", null, null, null, null, null, null, null);
    AgentToolContext.set(TOOL);
    try {
      inTenant(
          () ->
              AgentToolContext.suppressTouch(
                  () -> issueService.update(humanId, projectKey, issueNumber, req)));
      assertThat(activeWork(issueId, humanId).orElseThrow().state()).isEqualTo("WAITING");

      inTenant(() -> issueService.update(humanId, projectKey, issueNumber, req));
      assertThat(activeWork(issueId, humanId).orElseThrow().state()).isEqualTo("WORKING");
    } finally {
      AgentToolContext.clear();
    }
  }
}
