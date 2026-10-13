package com.workplace.issue;

import static com.workplace.jooq.Tables.ISSUE;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.issue.dto.CreateIssueRequest;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpMethod;
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

  @Test
  void MCP_DONE_은_이전_작업이_없어도_작업을_만들지_않음() {
    assertOk(patch(patToken, Map.of("status", "DONE"), TOOL));
    assertThat(activeCount(issueId)).isZero();
  }

  @Test
  void 프로젝트_멤버를_제거하면_그_사람_작업만_종료() {
    seedActive(issueId, humanId, "WORKING");
    seedActive(issueId, agentId, "WORKING");
    assertOk(
        call(
            org.springframework.http.HttpMethod.DELETE,
            "/api/v1/projects/" + projectKey + "/members/" + agentId,
            jwtToken,
            null,
            null));
    assertThat(activeWork(issueId, agentId)).isEmpty();
    assertThat(activeWork(issueId, humanId)).isPresent();
  }

  /** 이슈를 지우면(소프트 삭제) 그 이슈와 함께 지워진 자식 이슈의 진행 중 작업도 끝난다 — AI 위임 목록에 유령 작업이 남지 않게. */
  @Test
  void 이슈를_삭제하면_자식까지_작업_종료() {
    long childId =
        inTenant(
            () -> {
              var c =
                  issueService.create(
                      humanId,
                      projectKey,
                      new CreateIssueRequest("자식", "본문", "MID", null, List.of(), null, null, null));
              // 자식 관계만 필요하므로 SUBTASK 유형 절차 없이 parent_issue_id 를 직접 잇는다.
              dsl.update(ISSUE)
                  .set(ISSUE.PARENT_ISSUE_ID, issueId)
                  .where(ISSUE.ID.eq(c.id()))
                  .execute();
              return c.id();
            });
    seedActive(issueId, humanId, "WORKING");
    seedActive(childId, agentId, "WAITING");
    assertOk(call(HttpMethod.DELETE, issuePath(), jwtToken, null, null));
    assertThat(activeCount(issueId)).isZero();
    assertThat(activeCount(childId)).isZero();
  }
}
