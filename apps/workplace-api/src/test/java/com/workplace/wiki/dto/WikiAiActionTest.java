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
  void serialize_transformActions_toLowercaseWire() throws Exception {
    // 변형 액션 5종도 소문자 wire 로 직렬화돼야 ai-agent zod enum 이 수용한다.
    assertThat(mapper.writeValueAsString(WikiAiAction.REWRITE_TONE)).isEqualTo("\"rewrite_tone\"");
    assertThat(mapper.writeValueAsString(WikiAiAction.TRANSLATE)).isEqualTo("\"translate\"");
    assertThat(mapper.writeValueAsString(WikiAiAction.EXPAND)).isEqualTo("\"expand\"");
    assertThat(mapper.writeValueAsString(WikiAiAction.CONDENSE)).isEqualTo("\"condense\"");
    assertThat(mapper.writeValueAsString(WikiAiAction.POLISH)).isEqualTo("\"polish\"");
  }

  @Test
  void deserialize_transformActions_fromLowercaseJson() throws Exception {
    // 프론트가 보낸 소문자 변형 액션이 enum 으로 바인딩되는지.
    assertThat(mapper.readValue("\"rewrite_tone\"", WikiAiAction.class))
        .isEqualTo(WikiAiAction.REWRITE_TONE);
    assertThat(mapper.readValue("\"translate\"", WikiAiAction.class))
        .isEqualTo(WikiAiAction.TRANSLATE);
    assertThat(mapper.readValue("\"expand\"", WikiAiAction.class)).isEqualTo(WikiAiAction.EXPAND);
    assertThat(mapper.readValue("\"condense\"", WikiAiAction.class))
        .isEqualTo(WikiAiAction.CONDENSE);
    assertThat(mapper.readValue("\"polish\"", WikiAiAction.class)).isEqualTo(WikiAiAction.POLISH);
  }

  @Test
  void deserialize_unknown_throws() {
    assertThatThrownBy(() -> mapper.readValue("\"bogus\"", WikiAiAction.class))
        .hasMessageContaining("bogus");
  }
}
