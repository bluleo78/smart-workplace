package com.workplace.home.outbound;

import com.workplace.airun.AiCall;
import com.workplace.airun.AiCallTimeouts;
import com.workplace.airun.outbound.AiAgentHttp;
import com.workplace.airun.service.AiRunRecorder;
import com.workplace.global.outbound.AiAgentProperties;
import java.time.Duration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * 홈 채팅 전용 AiAgentChatClient Bean — JDK HttpClient 기반 SSE 스트리밍 (B2).
 *
 * <p>RestClient 기반 블로킹 호출에서 JDK HttpClient ofLines 스트리밍으로 전환했다. timeout 은 클라이언트 내부에서 관리한다.
 */
@Configuration
public class HomeChatConfig {

  /**
   * AiAgentChatClient Bean — props 에서 baseUrl/internalToken 을 가져오고, 요청 타임아웃은 상한 표(AI_CHAT)에 묶는다.
   */
  @Bean
  public AiAgentChatClient aiAgentChatClient(
      AiAgentProperties props, AiRunRecorder aiRunRecorder, AiCallTimeouts timeouts) {
    return new AiAgentChatClient(props, aiRunRecorder, timeouts);
  }

  /** 누적 요약 클라이언트의 read 상한 — 요약 실행 상한(HOME_CONTEXT_SUMMARY) + 여유. */
  static Duration contextSummaryReadTimeout(AiCallTimeouts timeouts) {
    return timeouts.readTimeoutFor(AiCall.HOME_CONTEXT_SUMMARY);
  }

  /** 추천 클라이언트 읽기 여유 — 사람이 턴 직후 기다리므로 공용 30초 대신 5초(기본 20+5=25초, WP-2111 이전 값). */
  static final Duration SUGGESTION_READ_MARGIN = Duration.ofSeconds(5);

  /** 공용 메모리 quick 검사 읽기 여유 — 채팅 턴 안에서 기다리므로 공용 30초 대신 3초(기본 12+3=15초, WP-2111 이전 값). */
  static final Duration SHARED_MEMORY_QUICK_READ_MARGIN = Duration.ofSeconds(3);

  /**
   * 추천 질문 클라이언트의 read 상한 — 한 클라이언트를 세 용도(시작·후속·선택지)가 같이 쓰므로 가장 긴 상한 + 짧은 여유({@link
   * #SUGGESTION_READ_MARGIN}).
   */
  static Duration suggestionReadTimeout(AiCallTimeouts timeouts) {
    return timeouts.readTimeoutWithMargin(
        SUGGESTION_READ_MARGIN,
        AiCall.HOME_SUGGESTIONS_STARTER,
        AiCall.HOME_SUGGESTIONS_FOLLOWUP,
        AiCall.HOME_SUGGESTIONS_QUESTION_OPTIONS);
  }

  /** 메모리 정리 클라이언트의 read 상한 — HOME_MEMORY_CLEANUP + 여유(effort 거절 재시도가 같은 상한 안에서 끝난다). */
  public static Duration memoryCleanupReadTimeout(AiCallTimeouts timeouts) {
    return timeouts.readTimeoutFor(AiCall.HOME_MEMORY_CLEANUP);
  }

  /** 공용 메모리 동기 검사의 read 상한 — 사용자 채팅 턴 안에서 기다리는 요청 검사 상한 + 짧은 여유. */
  static Duration sharedMemoryQuickReadTimeout(AiCallTimeouts timeouts) {
    return timeouts.readTimeoutWithMargin(
        SHARED_MEMORY_QUICK_READ_MARGIN, AiCall.HOME_SHARED_MEMORY_CHECK_REQUEST);
  }

  /**
   * 공용 메모리 배경(검사 배치·추출)의 read 상한 — 두 상한 중 큰 값 + 여유. 추출·검사가 같은 클라이언트라 메모리 정리의 공간 최악도 이 값으로
   * 센다(WP-2111).
   */
  public static Duration sharedMemorySlowReadTimeout(AiCallTimeouts timeouts) {
    return timeouts.readTimeoutFor(
        AiCall.HOME_SHARED_MEMORY_CHECK_BATCH, AiCall.HOME_SHARED_MEMORY_EXTRACT);
  }

  /** 누적 요약 클라이언트(WP-232) — connect 5s / read 는 상한 표 기준(요약 예산 + 여유), 무재시도. MessagingAiConfig 미러. */
  @Bean
  public AiAgentContextSummaryClient aiAgentContextSummaryClient(
      AiAgentProperties props, AiAgentHttp aiAgentHttp, AiCallTimeouts timeouts) {
    var builder =
        aiAgentHttp.restClient(
            props.baseUrl(), Duration.ofSeconds(5), contextSummaryReadTimeout(timeouts));
    return new AiAgentContextSummaryClient(builder, props.internalToken());
  }

  /** 추천 질문 클라이언트(WP-139) — connect 5s / read 는 상한 표 기준(세 용도 중 가장 긴 상한 + 여유). 무재시도. */
  @Bean
  public AiAgentSuggestionClient aiAgentSuggestionClient(
      AiAgentProperties props, AiAgentHttp aiAgentHttp, AiCallTimeouts timeouts) {
    var builder =
        aiAgentHttp.restClient(
            props.baseUrl(), Duration.ofSeconds(5), suggestionReadTimeout(timeouts));
    return new AiAgentSuggestionClient(builder, props.internalToken());
  }

  /** 메모리 배경 정리 클라이언트(WP-385) — connect 5s / read 는 상한 표 기준. 무재시도. */
  @Bean
  public AiAgentMemoryCleanupClient aiAgentMemoryCleanupClient(
      AiAgentProperties props, AiAgentHttp aiAgentHttp, AiCallTimeouts timeouts) {
    var builder =
        aiAgentHttp.restClient(
            props.baseUrl(), Duration.ofSeconds(5), memoryCleanupReadTimeout(timeouts));
    return new AiAgentMemoryCleanupClient(builder, props.internalToken());
  }

  /**
   * 공용 메모리 검사·추출 클라이언트(WP-386) — 동기 검사 connect 3s(사용자 채팅 턴 안에서 기다린다), 배경 connect 5s. read 는 둘 다 상한
   * 표 기준. 무재시도.
   */
  @Bean
  public AiAgentSharedMemoryClient aiAgentSharedMemoryClient(
      AiAgentProperties props, AiAgentHttp aiAgentHttp, AiCallTimeouts timeouts) {
    return new AiAgentSharedMemoryClient(
        aiAgentHttp.restClient(
            props.baseUrl(), Duration.ofSeconds(3), sharedMemoryQuickReadTimeout(timeouts)),
        aiAgentHttp.restClient(
            props.baseUrl(), Duration.ofSeconds(5), sharedMemorySlowReadTimeout(timeouts)),
        props.internalToken());
  }
}
