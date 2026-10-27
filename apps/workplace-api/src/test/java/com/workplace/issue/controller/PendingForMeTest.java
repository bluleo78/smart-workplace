package com.workplace.issue.controller;

import static com.workplace.jooq.Tables.CHAT_MESSAGE;
import static com.workplace.jooq.Tables.ISSUE_COMMENT;
import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
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
    // 담당자 행이 커넥션의 세션 GUC 가 아닌 테넌트#1 로 들어가게 트랜잭션 안에서 넣는다(WP-827).
    int number =
        inTenant(
            () -> {
              var issue =
                  issueService.create(
                      humanId,
                      projectKey,
                      new CreateIssueRequest(
                          title, "본문", "MID", null, List.of(), null, null, null));
              issueAssigneeRepository.add(issue.id(), agentId, humanId);
              return issue.number();
            });
    assertOk(
        call(
            HttpMethod.PUT,
            "/api/v1/projects/" + projectKey + "/issues/" + number + "/agent-work",
            akToken,
            Map.of("state", "WORKING", "message", "보고"),
            TOOL));
    return number;
  }

  /** 질문 → 답 → 새 글 흐름에서 AI 키·사람 토큰이 같은 규칙으로 잡힌다. */
  @Test
  void questionAnswerFlow_appliesSameRuleToAgentAndHuman() {
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

  /** 내 글만 있는 이슈, 삭제된 남의 글만 있는 이슈는 잡히지 않는다. */
  @Test
  void notPending_whenOnlyMyPostsOrOthersPostDeleted() {
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

  /** 여러 이슈가 한 번의 조회에 함께 잡힌다. */
  @Test
  void pending_includesSeveralIssuesInOneQuery() {
    // 같은 프로젝트에 이슈 둘 더 — 각 스레드에 AI 글.
    int n2 = createIssueWithAgentMessage("둘째");
    int n3 = createIssueWithAgentMessage("셋째");
    assertThat(pendingNumbers(jwtToken)).contains(n2, n3);
  }

  /** WP-719 — 담당 이슈에 댓글만 달려도 새 글로 잡히고, 내가 댓글로 답하면 빠진다. */
  @Test
  void pending_whenOthersCommentOnly_andClearedByMyComment() {
    // WP-719 — 답변 필요로 물은 뒤 사람이 이슈 챗 대신 댓글로 답한 경우.
    assertOk(putReport(akToken, TOOL, Map.of("state", "INPUT_REQUIRED", "message", "A/B?")));
    assertThat(pendingNumbers(akToken)).doesNotContain(issueNumber);

    assertOk(postComment(jwtToken, "B로 해 주세요", null));
    assertThat(pendingNumbers(akToken)).contains(issueNumber);

    // AI 가 댓글로 답해도 「내 마지막 글」로 센다.
    assertOk(postComment(akToken, "B로 진행할게요", TOOL));
    assertThat(pendingNumbers(akToken)).doesNotContain(issueNumber);
  }

  /** WP-719 — 담당이 되기 전부터 있던 남의 댓글(가져온 이슈의 옛 댓글 등)은 새 글이 아니고, 담당이 된 뒤 달린 댓글부터 센다. */
  @Test
  void notPending_forCommentsBeforeAssignment_butPendingForLaterComments() {
    inTenant(
        () ->
            dsl.insertInto(ISSUE_COMMENT)
                .set(ISSUE_COMMENT.ISSUE_ID, issueId)
                .set(ISSUE_COMMENT.AUTHOR_ID, otherId)
                .set(ISSUE_COMMENT.BODY, "맡기 전 옛 댓글")
                .set(
                    ISSUE_COMMENT.CREATED_AT,
                    java.time.OffsetDateTime.now(java.time.ZoneOffset.UTC).minusDays(1))
                .execute());
    assertThat(pendingNumbers(akToken)).doesNotContain(issueNumber);

    assertOk(postComment(otherPatToken, "맡은 뒤 새 댓글", null));
    assertThat(pendingNumbers(akToken)).contains(issueNumber);
  }

  /** WP-719 — 남의 댓글 뒤에 내 이슈 챗 글이 있으면 처리한 것으로 본다. */
  @Test
  void notPending_whenMyChatPostFollowsOthersComment() {
    assertOk(postComment(jwtToken, "확인 부탁", null));
    assertThat(pendingNumbers(akToken)).contains(issueNumber);

    assertOk(putReport(akToken, TOOL, Map.of("state", "WORKING", "message", "확인했어요")));
    assertThat(pendingNumbers(akToken)).doesNotContain(issueNumber);
  }

  /**
   * 같은 시각(created_at)으로 두 글을 시드한다 — 앞 글의 id 가 더 작다. 작성자 순서가 곧 (created_at, id) 순서. 시각은 담당이 된 뒤여야 한다
   * — 그 전 글은 새 글로 세지 않는다(WP-719).
   */
  private void seedSameInstant(long threadId, long firstAuthor, long secondAuthor) {
    java.time.OffsetDateTime at =
        java.time.OffsetDateTime.now(java.time.ZoneOffset.UTC)
            .plusMinutes(10)
            .truncatedTo(java.time.temporal.ChronoUnit.SECONDS);
    inTenant(
        () -> {
          for (long author : new long[] {firstAuthor, secondAuthor}) {
            dsl.insertInto(CHAT_MESSAGE)
                .set(CHAT_MESSAGE.THREAD_ID, threadId)
                .set(CHAT_MESSAGE.AUTHOR_ID, author)
                .set(CHAT_MESSAGE.BODY, "동시각")
                .set(CHAT_MESSAGE.MENTIONS, org.jooq.JSONB.valueOf("[]"))
                .set(CHAT_MESSAGE.CREATED_AT, at)
                .execute();
          }
          return null;
        });
  }

  /** 같은 시각이면 id 가 큰 글을 뒤로 본다 — 남의 글이 id 뒤면 새 글. */
  @Test
  void pending_whenSameInstant_andOthersPostHasLargerId() {
    // created_at 이 같아도 목록 순서는 (created_at, id) — 내 글(id 작음) 뒤에 남의 글이 있으니 새 글이다.
    seedSameInstant(chatThreadId(), humanId, otherId);
    assertThat(pendingNumbers(jwtToken)).contains(issueNumber);
  }

  /** 같은 시각이면 남의 글이 id 앞일 때 새 글이 아니다. */
  @Test
  void notPending_whenSameInstant_andOthersPostHasSmallerId() {
    // 남의 글(id 작음)이 내 글(id 큼)보다 앞 — created_at 만 비교하면 틀리게 잡히던 경우.
    seedSameInstant(chatThreadId(), otherId, humanId);
    assertThat(pendingNumbers(jwtToken)).doesNotContain(issueNumber);
  }
}
