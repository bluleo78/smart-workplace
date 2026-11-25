package com.workplace.issue.outbound;

import com.workplace.airun.AiCall;
import com.workplace.airun.AiCallTimeouts;
import com.workplace.airun.outbound.AiAgentHttp;
import com.workplace.global.outbound.AiAgentProperties;
import java.time.Duration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * 이슈 AI 전용 RestClient 빈 — connect 5s / read 는 상한 표 기준(ai-agent 예산 초과 보장), 무재시도. MessagingAiConfig
 * 미러. 프로젝트·개인 리포트(WP-1483)는 실행 예산이 길어 별도 RestClient 를 쓴다(WP-2111).
 */
@Configuration
public class IssueAiConfig {

  /** 연결 시간 제한. */
  static final Duration CONNECT_TIMEOUT = Duration.ofSeconds(5);

  /**
   * 일반 이슈 AI 호출의 읽기 시간 제한 — 이 클라이언트를 쓰는 호출(진행 요약·분류·업무 프로필·프로젝트 현황)의 실행 상한 중 가장 큰 값 + 여유. ai-agent
   * 의 LLM 예산을 넘어야 한다. 프로젝트 현황 스케줄러의 회차 시간 예산도 호출 하나의 최악을 이 값으로 센다(WP-2111).
   */
  public static Duration readTimeout(AiCallTimeouts timeouts) {
    return timeouts.readTimeoutFor(
        AiCall.ISSUE_PROGRESS_SUMMARY,
        AiCall.ISSUE_CLASSIFY,
        AiCall.WORK_PROFILE,
        AiCall.PROJECT_STATUS);
  }

  /** 리포트 읽기 시간 제한 — 프로젝트·개인 리포트 실행 상한 중 큰 값 + 여유. 리포트 스케줄러의 회차 시간 예산도 이 값으로 센다(WP-2111). */
  public static Duration reportReadTimeout(AiCallTimeouts timeouts) {
    return timeouts.readTimeoutFor(AiCall.PROJECT_REPORT, AiCall.PERSONAL_REPORT);
  }

  /**
   * 이슈 AI 전용 RestClient 를 구성한다.
   *
   * <p>connect 5s / read 는 {@link #readTimeout}(리포트는 {@link #reportReadTimeout}) — read timeout 은
   * ai-agent 의 LLM 예산을 반드시 초과해야 한다.
   */
  @Bean
  public AiAgentIssueClient aiAgentIssueClient(
      AiAgentProperties props, AiAgentHttp aiAgentHttp, AiCallTimeouts timeouts) {
    var builder = aiAgentHttp.restClient(props.baseUrl(), CONNECT_TIMEOUT, readTimeout(timeouts));
    var reportBuilder =
        aiAgentHttp.restClient(props.baseUrl(), CONNECT_TIMEOUT, reportReadTimeout(timeouts));
    return new AiAgentIssueClient(builder, reportBuilder, props.internalToken(), props.enabled());
  }
}
