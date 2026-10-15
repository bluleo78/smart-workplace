package com.workplace.home.outbound;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.global.ai.SharedMemoryLine;
import com.workplace.home.outbound.ChatMessages.ChatRequest;
import com.workplace.home.outbound.ChatMessages.CurrentSpace;
import java.util.List;
import org.junit.jupiter.api.Test;

/**
 * WP-386: ai-agent 로 가는 요청 본문의 공용 메모리 필드 이름 고정 — AiAgentChatClient 와 같은 모듈 없는 ObjectMapper 로 직렬화한다.
 * ai-agent 스키마와 이름이 어긋나면 공용 메모리가 조용히 사라지므로 JSON 이름을 테스트로 묶는다.
 */
class ChatRequestSharedMemoryWireTest {

  private final ObjectMapper mapper = new ObjectMapper();

  private static ChatRequest request(CurrentSpace space) {
    return new ChatRequest(
        "q",
        List.of(),
        5L,
        1L,
        1L,
        "m",
        "NORMAL",
        8,
        60000,
        null,
        null,
        "sid",
        List.of(),
        List.of(),
        true,
        null,
        null,
        0,
        List.of(new SharedMemoryLine("조직", "배포는 API 먼저 한다")),
        3,
        space);
  }

  @Test
  void 공용_메모리_필드와_지금_공간_이름을_그대로_보낸다() throws Exception {
    JsonNode json =
        mapper.readTree(
            mapper.writeValueAsString(request(new CurrentSpace("PROJECT", "WP 프로젝트(WP)"))));
    assertThat(json.get("sharedMemories").get(0).get("space").asText()).isEqualTo("조직");
    assertThat(json.get("sharedMemories").get(0).get("content").asText())
        .isEqualTo("배포는 API 먼저 한다");
    assertThat(json.get("sharedMemoryMoreCount").asInt()).isEqualTo(3);
    assertThat(json.get("currentSpace").get("type").asText()).isEqualTo("PROJECT");
    assertThat(json.get("currentSpace").get("name").asText()).isEqualTo("WP 프로젝트(WP)");
  }

  @Test
  void 지금_공간이_없으면_currentSpace_는_빠진다() throws Exception {
    JsonNode json = mapper.readTree(mapper.writeValueAsString(request(null)));
    assertThat(json.has("currentSpace")).isFalse();
    assertThat(json.has("sharedMemories")).isTrue();
  }
}
