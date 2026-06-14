package com.workplace.wiki.service;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.wiki.dto.WikiAiAction;
import org.junit.jupiter.api.Test;

/**
 * A↔B 와이어 계약 잠금 테스트. WikiAiService.AgentBody 를 실제 Jackson 으로 직렬화해 키 집합·값 표현이 ai-agent zod
 * (wikiComposeSchema) 와 정확히 일치함을 보장한다. 필드 rename/추가/누락이 silent 400 으로 빠지는 것을 컴파일·테스트 단계에서 차단.
 */
class AgentBodySerializationTest {

  private final ObjectMapper mapper = new ObjectMapper();

  /** selection/prompt 가 null 이면 JSON 에서 생략된다 — zod .optional() 은 null 이 아닌 undefined 만 허용. */
  @Test
  void serialize_nullOptionals_omitsSelectionAndPrompt() throws Exception {
    WikiAiService.AgentBody body =
        new WikiAiService.AgentBody(
            WikiAiAction.SUMMARIZE,
            "설계 문서",
            "## 본문",
            null, // selection
            null, // prompt
            900L,
            "claude-opus",
            "NORMAL",
            5,
            60_000);

    JsonNode json = mapper.readTree(mapper.writeValueAsString(body));

    // 키 집합이 정확히 8개(필수)여야 한다 — selection/prompt 는 생략.
    assertThat(json.fieldNames())
        .toIterable()
        .containsExactlyInAnyOrder(
            "action",
            "pageTitle",
            "pageBody",
            "assistantAgentId",
            "model",
            "thinkingDepth",
            "maxTurns",
            "timeoutMs");
    // action 은 소문자 와이어.
    assertThat(json.get("action").asText()).isEqualTo("summarize");
    assertThat(json.get("assistantAgentId").asLong()).isEqualTo(900L);
    assertThat(json.has("selection")).isFalse();
    assertThat(json.has("prompt")).isFalse();
  }

  /** selection/prompt 가 채워지면 JSON 에 포함된다(요약 선택영역·초안 지시문 전달). */
  @Test
  void serialize_withOptionals_includesSelectionAndPrompt() throws Exception {
    WikiAiService.AgentBody body =
        new WikiAiService.AgentBody(
            WikiAiAction.DRAFT,
            "제목",
            "본문",
            "선택된 텍스트",
            "이 주제로 써줘",
            901L,
            "claude-sonnet",
            "DEEP",
            3,
            30_000);

    JsonNode json = mapper.readTree(mapper.writeValueAsString(body));

    assertThat(json.fieldNames())
        .toIterable()
        .containsExactlyInAnyOrder(
            "action",
            "pageTitle",
            "pageBody",
            "selection",
            "prompt",
            "assistantAgentId",
            "model",
            "thinkingDepth",
            "maxTurns",
            "timeoutMs");
    assertThat(json.get("action").asText()).isEqualTo("draft");
    assertThat(json.get("selection").asText()).isEqualTo("선택된 텍스트");
    assertThat(json.get("prompt").asText()).isEqualTo("이 주제로 써줘");
  }
}
