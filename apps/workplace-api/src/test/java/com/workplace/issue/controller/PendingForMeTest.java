package com.workplace.issue.controller;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import com.workplace.global.tenant.TenantContext;
import com.workplace.issue.AgentWorkTestSupport;
import com.workplace.issue.dto.CreateIssueRequest;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpMethod;

/** /me/issues pendingForMe(WP-373 §3.4) — 내 마지막 이슈 챗 글 이후 다른 사람이 글을 남긴 이슈만. ak_·사람 토큰 같은 규칙. */
class PendingForMeTest extends AgentWorkTestSupport {

  /**
   * pendingForMe 로 조회한 이슈 번호들. REST /me/issues 는 assignee 를 주지 않으면 담당자 필터가 없다("any" 토큰은 MCP 전용이라
   * REST 에 주면 400).
   */
  private List<Integer> pendingNumbers(String token) {
    var res =
        call(
            HttpMethod.GET,
            "/api/v1/me/issues?pendingForMe=true&projectKey=" + projectKey,
            token,
            null,
            null);
    assertOk(res);
    List<Integer> out = new ArrayList<>();
    json(res).get("items").forEach(n -> out.add(n.get("number").asInt()));
    return out;
  }

  /** 같은 프로젝트에 AI 담당 이슈를 만들고 AI 가 보고 글을 남기게 한 뒤 이슈 번호를 돌려준다(시드 패턴은 seedAgentWorkFixture 와 같다). */
  private int createIssueWithAgentMessage(String title) {
    int number;
    TenantContext.set(TENANT_ID);
    try {
      var issue =
          issueService.create(
              humanId,
              projectKey,
              new CreateIssueRequest(title, "본문", "MID", null, List.of(), null, null, null));
      issueAssigneeRepository.add(issue.id(), agentId, humanId);
      number = issue.number();
    } finally {
      TenantContext.clear();
    }
    assertOk(
        call(
            HttpMethod.PUT,
            "/api/v1/projects/" + projectKey + "/issues/" + number + "/agent-work",
            akToken,
            Map.of("state", "WORKING", "message", "보고"),
            TOOL));
    return number;
  }

  @Test
  void 질문_답_새글_흐름에서_AI와_사람_양쪽이_같은_규칙() {
    assertOk(putReport(akToken, TOOL, Map.of("state", "INPUT_REQUIRED", "message", "A/B?")));
    assertThat(pendingNumbers(akToken)).doesNotContain(issueNumber); // 내 글 뒤에 남의 글 없음
    assertThat(pendingNumbers(jwtToken)).contains(issueNumber); // 사람은 쓴 적 없음 + AI 글 있음

    assertOk(postChat(jwtToken, "A로"));
    assertThat(pendingNumbers(akToken)).contains(issueNumber);
    assertThat(pendingNumbers(jwtToken)).doesNotContain(issueNumber);

    assertOk(putReport(akToken, TOOL, Map.of("state", "WORKING", "message", "A로 진행")));
    assertThat(pendingNumbers(akToken)).doesNotContain(issueNumber);
    assertThat(pendingNumbers(patToken)).contains(issueNumber); // 사람 PAT 도 같은 규칙(보고 글도 글)
  }

  @Test
  void 내_글만_있는_이슈와_삭제된_남의_글은_잡히지_않는다() {
    assertOk(postChat(jwtToken, "메모"));
    assertThat(pendingNumbers(jwtToken)).doesNotContain(issueNumber);

    assertOk(putReport(akToken, TOOL, Map.of("state", "WORKING", "message", "지울 글")));
    // 삭제 전에는 사람에게 처리 대기로 잡혀야 한다 — 필터가 항상 false 인 구현을 잡는다.
    assertThat(pendingNumbers(jwtToken)).contains(issueNumber);
    long id =
        json(
                call(
                    HttpMethod.GET,
                    "/api/v1/chat/threads/" + chatThreadId() + "/messages?afterMine=true",
                    jwtToken,
                    null,
                    null))
            .get("items")
            .findValues("id")
            .stream()
            .mapToLong(JsonNode::asLong)
            .max()
            .orElseThrow();
    assertOk(call(HttpMethod.DELETE, "/api/v1/chat/messages/" + id, akToken, null, null));
    assertThat(pendingNumbers(jwtToken)).doesNotContain(issueNumber);
  }

  @Test
  void 여러_이슈가_한_번의_조회에_함께_잡힌다() {
    // 같은 프로젝트에 이슈 둘 더 — 각 스레드에 AI 글.
    int n2 = createIssueWithAgentMessage("둘째");
    int n3 = createIssueWithAgentMessage("셋째");
    assertThat(pendingNumbers(jwtToken)).contains(n2, n3);
  }
}
