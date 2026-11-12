package com.workplace.issue.outbound;

import com.workplace.global.outbound.AiAgentProperties;
import com.workplace.global.outbound.InternalHttp;
import java.time.Duration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * 이슈 AI 전용 RestClient 빈 — connect 5s / read 90s(ai-agent 예산 초과 보장), 무재시도. MessagingAiConfig 미러.
 * 프로젝트 리포트(WP-1483)만 실행 예산이 길어(180초) read 210s 인 별도 RestClient 를 쓴다.
 */
@Configuration
public class IssueAiConfig {

  /** 연결 시간 제한. */
  static final Duration CONNECT_TIMEOUT = Duration.ofSeconds(5);

  /** 일반 이슈 AI 호출의 읽기 시간 제한 — ai-agent 의 LLM 예산을 넘어야 한다. */
  static final Duration READ_TIMEOUT = Duration.ofSeconds(90);

  /**
   * 프로젝트 리포트 읽기 시간 제한 — 리포트 실행 예산({@link AiAgentIssueClient#PROJECT_REPORT_TIMEOUT_MS} 180초)보다 길게.
   */
  static final Duration REPORT_READ_TIMEOUT = Duration.ofSeconds(210);

  /**
   * 이슈 AI 전용 RestClient 를 구성한다.
   *
   * <p>connect 5s / read 90s(리포트는 210s) — read timeout 은 ai-agent 의 LLM 예산을 반드시 초과해야 한다.
   */
  @Bean
  public AiAgentIssueClient aiAgentIssueClient(AiAgentProperties props) {
    var builder = InternalHttp.restClient(props.baseUrl(), CONNECT_TIMEOUT, READ_TIMEOUT);
    var reportBuilder =
        InternalHttp.restClient(props.baseUrl(), CONNECT_TIMEOUT, REPORT_READ_TIMEOUT);
    return new AiAgentIssueClient(builder, reportBuilder, props.internalToken());
  }
}
