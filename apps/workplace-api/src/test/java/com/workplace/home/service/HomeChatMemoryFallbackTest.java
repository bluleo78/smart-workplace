package com.workplace.home.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.home.outbound.ChatMessages.ChatMemory;
import com.workplace.home.outbound.ChatMessages.ChatRequest;
import java.util.List;
import org.junit.jupiter.api.Test;

/** WP-55: 메모리 주입의 순수 규칙 — 조회 실패 폴백, 블록 토큰 추정, ai-agent 로 나가는 JSON 모양(모듈 없는 ObjectMapper 직렬화). */
class HomeChatMemoryFallbackTest {

  @Test
  void 조회가_실패하면_꺼짐과_빈_목록으로_진행한다() {
    AiMemoryService.ChatMemories r =
        HomeChatService.memoriesOrUnavailable(
            () -> {
              throw new IllegalStateException("db down");
            },
            7L);
    assertThat(r.enabled()).isFalse();
    assertThat(r.items()).isEmpty();
  }

  /** CR5: 사용자 취소(인터럽트)는 조회 실패가 아니다 — 삼키지 않고 플래그를 되살려 던진다(펌프 catch 가 cancelled 로 마감). */
  @Test
  void 사용자_취소로_실패하면_삼키지_않고_인터럽트를_되살려_던진다() {
    RuntimeException cancel =
        new IllegalStateException("cancelled", new InterruptedException("user cancel"));
    try {
      assertThatThrownBy(
              () ->
                  HomeChatService.memoriesOrUnavailable(
                      () -> {
                        throw cancel;
                      },
                      7L))
          .isSameAs(cancel);
      assertThat(Thread.currentThread().isInterrupted()).isTrue();
    } finally {
      Thread.interrupted(); // JUnit 작업 스레드에 플래그를 남기지 않는다 — 다음 테스트의 JDBC 가 거부되지 않게
    }
  }

  @Test
  void 조회가_성공하면_그대로_쓴다() {
    var ok = new AiMemoryService.ChatMemories(true, List.of(new ChatMemory(3, "CONTEXT", "백엔드 팀")));
    assertThat(HomeChatService.memoriesOrUnavailable(() -> ok, 7L)).isSameAs(ok);
  }

  @Test
  void 블록_추정은_빈_목록이면_0_이고_줄마다_내용과_접두를_더한다() {
    assertThat(AiMemoryService.estimateBlockTokens(List.of())).isZero();
    assertThat(
            AiMemoryService.estimateBlockTokens(
                List.of(
                    new ChatMemory(1, "PREFERENCE", "가나다"), new ChatMemory(2, "CONTEXT", "abcd"))))
        .isEqualTo(
            AiMemoryService.BLOCK_HEADER_TOKENS
                + (3 + AiMemoryService.LINE_OVERHEAD_TOKENS)
                + (1 + AiMemoryService.LINE_OVERHEAD_TOKENS));
  }

  @Test
  void ai_agent_요청_JSON_에_memories_와_memoryEnabled_가_실린다() throws Exception {
    ChatRequest req =
        new ChatRequest(
            "q",
            List.of(),
            5L,
            1L,
            null,
            "m",
            "NORMAL",
            8,
            60000,
            null,
            null,
            null,
            List.of(),
            List.of(new ChatMemory(12, "PREFERENCE", "짧은 목록으로 보여 준다")),
            true);
    String json = new ObjectMapper().writeValueAsString(req);
    assertThat(json)
        .contains(
            "\"memories\":[{\"id\":12,\"kind\":\"PREFERENCE\",\"content\":\"짧은 목록으로 보여 준다\"}]")
        .contains("\"memoryEnabled\":true");
  }

  @Test
  void 메모리_도구_판별은_Claude_opencode_접두를_무시하고_다른_도구는_아니다() {
    for (String n : List.of("remember_memory", "update_memory", "forget_memory")) {
      assertThat(HomeChatService.isMemoryTool(n)).isTrue();
      assertThat(HomeChatService.isMemoryTool("mcp__workplace__" + n)).isTrue();
      assertThat(HomeChatService.isMemoryTool("workplace_" + n)).isTrue();
    }
    assertThat(HomeChatService.isMemoryTool("update_issue")).isFalse();
    assertThat(HomeChatService.isMemoryTool("mcp__workplace__show_memory")).isFalse();
  }
}
