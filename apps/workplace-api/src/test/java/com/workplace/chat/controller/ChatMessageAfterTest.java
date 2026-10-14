package com.workplace.chat.controller;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import com.workplace.issue.AgentWorkTestSupport;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;

/** 이슈 챗 메시지 after·afterMine 조회와 스레드 externalAgent(WP-373 §3.3·§5.2) — 실제 HTTP 로 검증한다. */
class ChatMessageAfterTest extends AgentWorkTestSupport {

  private String messagesPath() {
    return "/api/v1/chat/threads/" + chatThreadId() + "/messages";
  }

  private List<String> bodies(JsonNode page) {
    List<String> out = new ArrayList<>();
    page.get("items").forEach(n -> out.add(n.get("body").asText()));
    return out;
  }

  /** 사람 JWT 로 n 개 글을 순서대로 올리고 id 를 돌려준다. */
  private List<Long> postMany(String token, String prefix, int n) {
    List<Long> ids = new ArrayList<>();
    for (int i = 1; i <= n; i++) {
      var r = postChat(token, prefix + i);
      assertOk(r);
      ids.add(json(r).get("id").asLong());
    }
    return ids;
  }

  @Test
  void after_는_그_뒤를_오름차순으로_주고_limit_을_넘으면_hasMore_와_next() {
    List<Long> ids = postMany(jwtToken, "m", 5);
    var page =
        json(
            call(
                HttpMethod.GET,
                messagesPath() + "?after=" + ids.get(0) + "&limit=3",
                jwtToken,
                null,
                null));
    assertThat(bodies(page)).containsExactly("m2", "m3", "m4");
    assertThat(page.get("hasMore").asBoolean()).isTrue();
    assertThat(page.get("nextCursor").asText()).isEqualTo(String.valueOf(ids.get(3)));
    var next =
        json(
            call(
                HttpMethod.GET,
                messagesPath() + "?after=" + ids.get(3) + "&limit=3",
                jwtToken,
                null,
                null));
    assertThat(bodies(next)).containsExactly("m5");
    assertThat(next.get("hasMore").asBoolean()).isFalse();
    assertThat(next.get("nextCursor").isNull()).isTrue();
  }

  @Test
  void afterMine_은_내_마지막_글_직전_5개와_그_뒤를_준다() {
    postMany(jwtToken, "h", 7); // 사람 h1..h7
    assertOk(putReport(akToken, TOOL, Map.of("state", "WORKING", "message", "a1"))); // AI 의 마지막 글
    assertOk(postChat(jwtToken, "h8"));
    assertOk(postChat(jwtToken, "h9"));
    var page = json(call(HttpMethod.GET, messagesPath() + "?afterMine=true", akToken, null, null));
    assertThat(bodies(page)).containsExactly("h3", "h4", "h5", "h6", "h7", "a1", "h8", "h9");
    assertThat(page.get("hasMore").asBoolean()).isFalse();
  }

  @Test
  void afterMine_은_내_글이_없으면_최신_limit_개를_오름차순으로() {
    postMany(jwtToken, "h", 4);
    var page =
        json(call(HttpMethod.GET, messagesPath() + "?afterMine=true&limit=2", akToken, null, null));
    assertThat(bodies(page)).containsExactly("h3", "h4");
    assertThat(page.get("hasMore").asBoolean()).isFalse();
    // 더 오래된 글이 잘렸으므로 이어 읽을 커서는 없어도 부분 목록임을 알린다.
    assertThat(page.get("truncated").asBoolean()).isTrue();
  }

  @Test
  void afterMine_은_내_글이_없고_전부_담기면_truncated_가_없다() {
    postMany(jwtToken, "h", 2);
    var page =
        json(call(HttpMethod.GET, messagesPath() + "?afterMine=true&limit=2", akToken, null, null));
    assertThat(bodies(page)).containsExactly("h1", "h2");
    assertThat(page.has("truncated")).isFalse();
  }

  @Test
  void afterMine_은_삭제한_내_글을_기준으로_삼지_않는다() {
    assertOk(putReport(akToken, TOOL, Map.of("state", "WORKING", "message", "a1")));
    assertOk(postChat(jwtToken, "h1"));
    var r = putReport(akToken, TOOL, Map.of("state", "WORKING", "message", "a2"));
    assertOk(r);
    long a2 =
        json(call(HttpMethod.GET, messagesPath() + "?afterMine=true", akToken, null, null))
            .get("items")
            .findValues("id")
            .stream()
            .mapToLong(JsonNode::asLong)
            .max()
            .orElseThrow();
    assertOk(call(HttpMethod.DELETE, "/api/v1/chat/messages/" + a2, akToken, null, null));
    var page = json(call(HttpMethod.GET, messagesPath() + "?afterMine=true", akToken, null, null));
    // 기준은 a1 — 그 뒤의 h1 과 삭제 표시된 a2 가 함께 온다.
    assertThat(bodies(page)).containsExactly("a1", "h1", "(삭제됨)");
  }

  @Test
  void after_의_400_세_가지() {
    List<Long> ids = postMany(jwtToken, "m", 1);
    assertThat(
            call(
                    HttpMethod.GET,
                    messagesPath() + "?after=" + ids.get(0) + "&cursor=abc",
                    jwtToken,
                    null,
                    null)
                .getStatusCode())
        .isEqualTo(HttpStatus.BAD_REQUEST);
    assertThat(
            call(
                    HttpMethod.GET,
                    messagesPath() + "?after=" + ids.get(0) + "&afterMine=true",
                    jwtToken,
                    null,
                    null)
                .getStatusCode())
        .isEqualTo(HttpStatus.BAD_REQUEST);
    assertThat(
            call(HttpMethod.GET, messagesPath() + "?after=999999999", jwtToken, null, null)
                .getStatusCode())
        .isEqualTo(HttpStatus.BAD_REQUEST);
  }

  @Test
  void 스레드_응답의_externalAgent_는_외부_실행_AI_담당자만() {
    var before = json(call(HttpMethod.GET, issuePath() + "/chat/thread", jwtToken, null, null));
    assertThat(before.get("externalAgent").isNull()).isTrue(); // 기본은 내부 실행(INTERNAL)
    makeExternal(agentId);
    var after = json(call(HttpMethod.GET, issuePath() + "/chat/thread", jwtToken, null, null));
    assertThat(after.get("externalAgent").get("id").asLong()).isEqualTo(agentId);
    assertThat(after.get("externalAgent").get("kind").asText()).isEqualTo("AGENT");
  }
}
