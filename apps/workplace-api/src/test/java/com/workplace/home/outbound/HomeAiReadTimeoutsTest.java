package com.workplace.home.outbound;

import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.airun.AiCall;
import com.workplace.airun.AiCallTimeouts;
import com.workplace.home.service.HomeChatService;
import java.time.Duration;
import org.junit.jupiter.api.Test;

/**
 * 홈 AI 클라이언트의 read 상한이 그 클라이언트가 나르는 호출의 실행 상한 표 값을 항상 넘는지 검증한다(WP-2111). 상한을 덮어써도 읽기가 먼저 끊기지 않아야
 * 한다.
 */
class HomeAiReadTimeoutsTest {

  private static final Duration MARGIN = AiCallTimeouts.READ_MARGIN;

  @Test
  void 기본값에서_각_읽기_상한은_나르는_항목_상한을_넘는다() {
    AiCallTimeouts t = AiCallTimeouts.defaults();

    assertThat(PriorityAiConfig.readTimeout(t))
        .isGreaterThan(t.timeout(AiCall.HOME_PRIORITY_CLASSIFY));
    assertThat(HomeChatConfig.contextSummaryReadTimeout(t))
        .isGreaterThan(t.timeout(AiCall.HOME_CONTEXT_SUMMARY));
    assertThat(HomeChatConfig.suggestionReadTimeout(t))
        .isGreaterThan(t.timeout(AiCall.HOME_SUGGESTIONS_STARTER))
        .isGreaterThan(t.timeout(AiCall.HOME_SUGGESTIONS_FOLLOWUP))
        .isGreaterThan(t.timeout(AiCall.HOME_SUGGESTIONS_QUESTION_OPTIONS));
    assertThat(HomeChatConfig.memoryCleanupReadTimeout(t))
        .isGreaterThan(t.timeout(AiCall.HOME_MEMORY_CLEANUP));
    assertThat(HomeChatConfig.sharedMemoryQuickReadTimeout(t))
        .isGreaterThan(t.timeout(AiCall.HOME_SHARED_MEMORY_CHECK_REQUEST));
    assertThat(HomeChatConfig.sharedMemorySlowReadTimeout(t))
        .isGreaterThan(t.timeout(AiCall.HOME_SHARED_MEMORY_CHECK_BATCH))
        .isGreaterThan(t.timeout(AiCall.HOME_SHARED_MEMORY_EXTRACT));
  }

  @Test
  void 덮어쓰면_읽기_상한이_덮어쓴_값_더하기_여유가_된다() {
    AiCallTimeouts t = new AiCallTimeouts("HOME_PRIORITY_CLASSIFY=5m");

    assertThat(PriorityAiConfig.readTimeout(t)).isEqualTo(Duration.ofMinutes(5).plus(MARGIN));
    assertThat(PriorityAiConfig.readTimeout(t)).isEqualTo(Duration.ofSeconds(330));
  }

  @Test
  void 여러_항목을_나르는_클라이언트는_그중_덮어쓴_가장_큰_값을_따른다() {
    AiCallTimeouts t = new AiCallTimeouts("HOME_SUGGESTIONS_STARTER=50s");

    // 추천은 사람이 기다리는 동기 클라이언트라 짧은 여유(5초)를 쓴다
    assertThat(HomeChatConfig.suggestionReadTimeout(t)).isEqualTo(Duration.ofSeconds(55));
  }

  @Test
  void 사람이_기다리는_동기_클라이언트는_예전_읽기_상한을_지킨다() {
    AiCallTimeouts t = AiCallTimeouts.defaults();

    // WP-2111 이전 값 — 공용 메모리 quick 검사 15초(12+3), 추천 25초(20+5). 공용 여유 30초면 42초·50초로 대기가 늘었다.
    assertThat(HomeChatConfig.sharedMemoryQuickReadTimeout(t)).isEqualTo(Duration.ofSeconds(15));
    assertThat(HomeChatConfig.suggestionReadTimeout(t)).isEqualTo(Duration.ofSeconds(25));
  }

  @Test
  void AI_CHAT_덮어쓰기_최대에_읽기_여유를_더해도_턴_상한_300초를_넘지_않는다() {
    // AiCall.AI_CHAT 의 maxOverride 와 HomeChatService.turnTimeout() 의 결합 — 최대를 올리면 레지스트리 하한(300초)보다
    // HTTP 가 길어진다.
    assertThat(AiCall.AI_CHAT.maxOverride().plus(MARGIN))
        .isLessThanOrEqualTo(HomeChatService.turnTimeout());
    assertThat(HomeChatService.turnTimeout()).isEqualTo(Duration.ofSeconds(300));
  }

  @Test
  void 채팅_요청_타임아웃은_300초_하한과_AI_CHAT_읽기_상한_중_큰_값이다() {
    assertThat(AiAgentChatClient.requestTimeout(AiCallTimeouts.defaults()))
        .isEqualTo(Duration.ofSeconds(300));
    // 덮어쓰기 최대(4분)+여유(30초)=270초가 하한 300초보다 작아 하한이 이긴다.
    assertThat(AiAgentChatClient.requestTimeout(new AiCallTimeouts("AI_CHAT=4m")))
        .isEqualTo(Duration.ofSeconds(300));
  }

  @Test
  void 생성_레지스트리_상한과_HTTP_요청_타임아웃은_같은_값이다() {
    // HomeChatService 가 레지스트리 상한으로 쓰는 값은 requestTimeout 과 같아, AI_CHAT 덮어쓰기에도 HTTP 보다 먼저 끊지 않는다.
    assertThat(AiAgentChatClient.requestTimeout(new AiCallTimeouts("AI_CHAT=4m")))
        .isEqualTo(HomeChatService.turnTimeout());
  }
}
