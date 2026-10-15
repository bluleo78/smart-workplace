package com.workplace.home.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.global.ai.AiMemoryLine;
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
    var ok =
        new AiMemoryService.ChatMemories(
            true,
            List.of(new AiMemoryLine(3, "CONTEXT", "백엔드 팀", null, null, null)),
            "2026-10-14",
            0);
    assertThat(HomeChatService.memoriesOrUnavailable(() -> ok, 7L)).isSameAs(ok);
  }

  /** 꺼짐은 0, 켜짐 + 0개는 빈 블록(머리·안내·오늘 줄) 몫, 그 밖에는 머리 + 줄마다 내용과 접두. */
  @Test
  void 블록_추정은_꺼짐이면_0_빈_목록이면_빈_블록_몫_줄마다_내용과_접두를_더한다() {
    assertThat(AiMemoryService.estimateBlockTokens(AiMemoryService.ChatMemories.DISABLED)).isZero();
    assertThat(
            AiMemoryService.estimateBlockTokens(
                new AiMemoryService.ChatMemories(true, List.of(), "2026-10-14", 0)))
        .isEqualTo(AiMemoryService.EMPTY_BLOCK_TOKENS);
    assertThat(
            AiMemoryService.estimateBlockTokens(
                new AiMemoryService.ChatMemories(
                    true,
                    List.of(
                        new AiMemoryLine(1, "PREFERENCE", "가나다", null, null, null),
                        new AiMemoryLine(2, "CONTEXT", "abcd", null, null, null)),
                    "2026-10-14",
                    0)))
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
            List.of(new AiMemoryLine(12, "PREFERENCE", "짧은 목록으로 보여 준다", null, null, null)),
            true,
            null,
            null,
            0,
            List.of(),
            0,
            null);
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

  /** WP-379: 메모리 범위는 있을 때만 JSON 에 싣고(구 ai-agent 와 같은 모양 유지), 지금 화면 앱을 함께 보낸다. */
  @Test
  void ai_agent_요청_JSON_에_범위와_app_이_실린다() throws Exception {
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
            List.of(
                new AiMemoryLine(12, "PREFERENCE", "짧게", "ISSUE", null, null),
                new AiMemoryLine(9, "CONTEXT", "백엔드 팀", null, null, null)),
            true,
            "ISSUE",
            null,
            0,
            List.of(),
            0,
            null);
    String json = new ObjectMapper().writeValueAsString(req);
    assertThat(json)
        .contains("{\"id\":12,\"kind\":\"PREFERENCE\",\"content\":\"짧게\",\"scope\":\"ISSUE\"}")
        .contains("{\"id\":9,\"kind\":\"CONTEXT\",\"content\":\"백엔드 팀\"}")
        .contains("\"app\":\"ISSUE\"");
  }

  /** WP-380: 기한은 있을 때만 싣고(문자열 yyyy-MM-dd — outbound 에 java.time 없음), today 를 함께 보낸다. */
  @Test
  void ai_agent_요청_JSON_에_기한과_오늘이_실린다() throws Exception {
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
            List.of(
                new AiMemoryLine(12, "PREFERENCE", "짧게", null, "2026-10-24", null),
                new AiMemoryLine(9, "CONTEXT", "백엔드 팀", null, null, null)),
            true,
            null,
            "2026-10-14",
            0,
            List.of(),
            0,
            null);
    String json = new ObjectMapper().writeValueAsString(req);
    assertThat(json)
        .contains(
            "{\"id\":12,\"kind\":\"PREFERENCE\",\"content\":\"짧게\",\"expiresOn\":\"2026-10-24\"}")
        .contains("{\"id\":9,\"kind\":\"CONTEXT\",\"content\":\"백엔드 팀\"}")
        .contains("\"today\":\"2026-10-14\"");
  }

  /** WP-383: "더 있음" 줄이 실리면 그 몫을, 고정 줄이면 라벨 몫을 더한다 — 빈 목록 + 더 있음도 센다(홈에 공통 0·앱만 있을 때). */
  @Test
  void 블록_추정은_더_있음_줄과_고정_라벨을_센다() {
    assertThat(
            AiMemoryService.estimateBlockTokens(
                new AiMemoryService.ChatMemories(true, List.of(), "2026-10-14", 3)))
        .isEqualTo(AiMemoryService.EMPTY_BLOCK_TOKENS + AiMemoryService.MORE_LINE_TOKENS);
    assertThat(
            AiMemoryService.estimateBlockTokens(
                new AiMemoryService.ChatMemories(
                    true,
                    List.of(new AiMemoryLine(1, "PREFERENCE", "가나다", null, null, true)),
                    "2026-10-14",
                    5)))
        .isEqualTo(
            AiMemoryService.BLOCK_HEADER_TOKENS
                + AiMemoryService.MORE_LINE_TOKENS
                + 3
                + AiMemoryService.LINE_OVERHEAD_TOKENS
                + AiMemoryService.PIN_LABEL_TOKENS);
  }

  /** WP-383: memoryMoreCount 는 늘 싣고, pinned 는 고정일 때만 싣는다(아니면 구 ai-agent 와 같은 줄 모양). */
  @Test
  void ai_agent_요청_JSON_에_더_있음_수와_고정이_실린다() throws Exception {
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
            List.of(
                new AiMemoryLine(12, "PREFERENCE", "짧게", null, null, true),
                new AiMemoryLine(9, "CONTEXT", "백엔드 팀", null, null, null)),
            true,
            null,
            "2026-10-14",
            7,
            List.of(),
            0,
            null);
    String json = new ObjectMapper().writeValueAsString(req);
    assertThat(json)
        .contains("{\"id\":12,\"kind\":\"PREFERENCE\",\"content\":\"짧게\",\"pinned\":true}")
        .contains("{\"id\":9,\"kind\":\"CONTEXT\",\"content\":\"백엔드 팀\"}")
        .contains("\"memoryMoreCount\":7");
  }
}
