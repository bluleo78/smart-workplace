package com.workplace.issue.controller;

import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.issue.AgentWorkTestSupport;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;

/**
 * AI 구성원의 담당자 지정(WP-453) 실제 HTTP 통합 테스트. AI 도 사람처럼 이슈를 만들거나 고치며 다른 AI·사람을 담당자로 넣고 뺄 수 있고, 프로젝트 구성원만
 * 담당할 수 있다는 공통 규칙은 그대로임을 ak_ 키 요청으로 확인한다. 시드: 이슈(담당 사람+AI), 외부 실행으로 일을 받을 두 번째 AI.
 */
class AgentAssignOthersTest extends AgentWorkTestSupport {

  private long receiverId;

  @BeforeEach
  void seedReceiver() {
    receiverId = addAgentMember("aw-receiver");
    makeExternal(receiverId);
  }

  @Test
  void AI_가_다른_AI_를_담당자로_넣으면_받은_외부_AI_에게_시작전_작업이_생긴다() {
    var r = putAssignees(akToken, List.of(humanId, agentId, receiverId), TOOL);

    assertOk(r);
    assertThat(assignees(issueId)).containsExactlyInAnyOrder(humanId, agentId, receiverId);
    // 받은 AI 가 다음 polling 에서 집어 갈 수 있게 "시작 전" 작업이 만들어진다(WP-377).
    assertThat(activeWork(issueId, receiverId).orElseThrow().state()).isEqualTo("SUBMITTED");
  }

  @Test
  void AI_가_다른_담당자를_뺄_수_있다() {
    var r = putAssignees(akToken, List.of(agentId), TOOL);

    assertOk(r);
    assertThat(assignees(issueId)).containsExactly(agentId);
  }

  @Test
  void AI_가_이슈를_만들며_다른_AI_와_사람을_담당자로_지정할_수_있다() {
    var r =
        call(
            HttpMethod.POST,
            "/api/v1/projects/" + projectKey + "/issues",
            akToken,
            Map.of("title", "리뷰 맡기기", "assigneeIds", List.of(humanId, receiverId)),
            TOOL);

    assertOk(r);
    long created = json(r).get("id").asLong();
    assertThat(assignees(created)).containsExactlyInAnyOrder(humanId, receiverId);
    assertThat(activeWork(created, receiverId).orElseThrow().state()).isEqualTo("SUBMITTED");
  }

  @Test
  void 프로젝트_구성원이_아닌_사용자는_AI_도_담당자로_넣을_수_없다() {
    long outsider = addAgent("aw-outsider");

    var r = putAssignees(akToken, List.of(agentId, outsider), TOOL);

    assertThat(r.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
    assertThat(assignees(issueId)).containsExactlyInAnyOrder(humanId, agentId);
  }

  private List<Long> assignees(long id) {
    return inTenant(() -> issueAssigneeRepository.findUserIdsByIssue(id));
  }
}
