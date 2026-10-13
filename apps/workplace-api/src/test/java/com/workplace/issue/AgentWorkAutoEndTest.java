package com.workplace.issue;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.http.ResponseEntity;

/**
 * 이슈 종료·담당 해제 → AI 작업 자동 종료(WP-377, 스펙 §4.3). 종료 뒤 MCP 쓰기·재오픈이 작업을 되살리지 않는지도 검증한다. 시각 단언 없이 상태·개수만
 * 본다.
 */
class AgentWorkAutoEndTest extends AgentWorkTestSupport {

  /** 요청이 성공했는지 — 거절로 인한 거짓 통과를 막는다. */
  private static void assertOk(ResponseEntity<String> res) {
    assertThat(res.getStatusCode().is2xxSuccessful()).as(res.getBody()).isTrue();
  }

  @Test
  void 웹에서_DONE_으로_바꾸면_그_이슈_작업_전부_종료() {
    seedActive(issueId, humanId, "WORKING");
    seedActive(issueId, agentId, "WAITING");
    assertOk(patch(jwtToken, Map.of("status", "DONE"), null));
    assertThat(activeCount(issueId)).isZero();
  }

  @Test
  void CANCELED_도_종료() {
    seedActive(issueId, humanId, "WORKING");
    assertOk(patch(jwtToken, Map.of("status", "CANCELED"), null));
    assertThat(activeCount(issueId)).isZero();
  }

  @Test
  void MCP_update_issue_DONE_뒤_자동시작으로_되살아나지_않음() {
    seedActive(issueId, humanId, "WORKING");
    assertOk(patch(patToken, Map.of("status", "DONE"), TOOL));
    assertThat(activeCount(issueId)).isZero();
  }

  @Test
  void 담당자에서_빼면_그_사람_것만_종료() {
    seedActive(issueId, humanId, "WORKING");
    seedActive(issueId, agentId, "WORKING");
    assertOk(putAssignees(jwtToken, List.of(agentId), null));
    assertThat(activeWork(issueId, humanId)).isEmpty();
    assertThat(activeWork(issueId, agentId)).isPresent();
  }

  @Test
  void MCP_로_자기를_담당에서_빼면_다시_만들지_않음() {
    seedActive(issueId, humanId, "WORKING");
    assertOk(putAssignees(patToken, List.of(agentId), TOOL));
    assertThat(activeWork(issueId, humanId)).isEmpty();
  }

  @Test
  void 재오픈해도_자동으로_되살리지_않음() {
    seedActive(issueId, humanId, "WORKING");
    assertOk(patch(jwtToken, Map.of("status", "DONE"), null));
    assertOk(patch(jwtToken, Map.of("status", "IN_PROGRESS"), null));
    assertThat(activeWork(issueId, humanId)).isEmpty();
  }
}
