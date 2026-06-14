package com.workplace.wiki.dto;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

/** WikiAiAction 와이어 포맷(소문자) 직렬화·역직렬화 검증 — 프론트/에이전트 zod 계약 일치. */
class WikiAiActionTest {

  private final ObjectMapper mapper = new ObjectMapper();

  @Test
  void deserialize_fromLowercaseJson() throws Exception {
    // 프론트가 소문자로 보낸 액션이 enum 으로 바인딩되는지(요청 본문 안에서).
    WikiAiRequest req =
        mapper.readValue(
            "{\"action\":\"summarize\",\"prompt\":null,\"selection\":null}", WikiAiRequest.class);
    assertThat(req.action()).isEqualTo(WikiAiAction.SUMMARIZE);

    assertThat(mapper.readValue("\"draft\"", WikiAiAction.class)).isEqualTo(WikiAiAction.DRAFT);
    assertThat(mapper.readValue("\"continue\"", WikiAiAction.class))
        .isEqualTo(WikiAiAction.CONTINUE);
  }

  @Test
  void deserialize_isCaseTolerant() throws Exception {
    // 대문자/혼합 입력도 관용적으로 바인딩.
    assertThat(mapper.readValue("\"SUMMARIZE\"", WikiAiAction.class))
        .isEqualTo(WikiAiAction.SUMMARIZE);
  }

  @Test
  void serialize_toLowercaseWire() throws Exception {
    // 에이전트로 전달될 본문 직렬화도 소문자여야 함(아니면 zod enum 거부).
    assertThat(mapper.writeValueAsString(WikiAiAction.SUMMARIZE)).isEqualTo("\"summarize\"");
    assertThat(mapper.writeValueAsString(WikiAiAction.DRAFT)).isEqualTo("\"draft\"");
    assertThat(mapper.writeValueAsString(WikiAiAction.CONTINUE)).isEqualTo("\"continue\"");
  }

  @Test
  void deserialize_unknown_throws() {
    assertThatThrownBy(() -> mapper.readValue("\"bogus\"", WikiAiAction.class))
        .hasMessageContaining("bogus");
  }
}
