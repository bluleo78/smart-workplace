package com.workplace.chat.controller;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import com.workplace.issue.AgentWorkTestSupport;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;

/**
 * WP-1582: 이슈 챗 메시지 목록(GET /api/v1/chat/threads/{id}/messages)에 깨진 cursor 를 주면 500 이나 내부 예외 원문이 아니라
 * 400 과 한국어 안내로 응답한다 — 팀 채팅(WP-512 MessagingBadInputTest)과 같은 규칙.
 *
 * <p>이슈 챗 스레드 시드·인증을 그대로 쓰려고 {@link AgentWorkTestSupport}(IntegrationTestBase 상속, 실제 HTTP)를 쓴다.
 */
class ChatMessageCursorBadInputTest extends AgentWorkTestSupport {

  /** 메시지 목록 경로. */
  private String messagesPath() {
    return "/api/v1/chat/threads/" + chatThreadId() + "/messages";
  }

  /** 깨진 cursor 는 HTTP 에서 400 + 한국어 안내로 나간다 — 값별 거절은 ChatMessageCursorTest 가 본다. */
  @Test
  void 깨진_cursor_는_400_과_한국어_안내() {
    var res = call(HttpMethod.GET, messagesPath() + "?cursor=MQ", jwtToken, null, null);
    assertThat(res.getStatusCode()).as(res.getBody()).isEqualTo(HttpStatus.BAD_REQUEST);
    assertThat(json(res).get("message").asText()).isEqualTo("목록 위치(cursor)가 올바르지 않습니다");
  }

  /** 첫 페이지 응답의 nextCursor 로는 정상적으로 다음(더 오래된) 페이지를 받는다 — 변환이 정상 커서를 막지 않는지. */
  @Test
  void 정상_cursor_는_다음_페이지를_200_으로() {
    for (int i = 1; i <= 3; i++) {
      assertOk(postChat(jwtToken, "m" + i));
    }
    var first = json(call(HttpMethod.GET, messagesPath() + "?limit=2", jwtToken, null, null));
    assertThat(first.get("hasMore").asBoolean()).isTrue();
    String next = first.get("nextCursor").asText();

    var res =
        call(HttpMethod.GET, messagesPath() + "?limit=2&cursor=" + next, jwtToken, null, null);
    assertOk(res);
    // 첫 페이지(최신 2건)와 겹치지 않는 더 오래된 글이 온다.
    List<String> firstBodies = bodies(first);
    List<String> secondBodies = bodies(json(res));
    assertThat(secondBodies).isNotEmpty().doesNotContainAnyElementsOf(firstBodies);
  }

  /** 페이지 items 의 본문 목록. */
  private static List<String> bodies(JsonNode page) {
    List<String> out = new ArrayList<>();
    page.get("items").forEach(n -> out.add(n.get("body").asText()));
    return out;
  }
}
