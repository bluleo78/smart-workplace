package com.workplace.issue.outbound;

import com.workplace.global.outbound.AiAgentProperties;
import com.workplace.global.outbound.InternalHttp;
import java.time.Duration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/** 이슈 AI 전용 RestClient 빈 — connect 5s / read 90s(ai-agent 예산 초과 보장), 무재시도. MessagingAiConfig 미러. */
@Configuration
public class IssueAiConfig {

  /**
   * 이슈 AI 전용 RestClient 를 구성한다.
   *
   * <p>connect 5s / read 90s — read timeout 은 ai-agent 의 LLM 예산을 반드시 초과해야 한다.
   */
  @Bean
  public AiAgentIssueClient aiAgentIssueClient(AiAgentProperties props) {
    var builder =
        InternalHttp.restClient(props.baseUrl(), Duration.ofSeconds(5), Duration.ofSeconds(90));
    return new AiAgentIssueClient(builder, props.internalToken());
  }
}
