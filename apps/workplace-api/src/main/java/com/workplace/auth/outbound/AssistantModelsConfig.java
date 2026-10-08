package com.workplace.auth.outbound;

import com.workplace.global.outbound.AiAgentProperties;
import com.workplace.global.outbound.InternalHttp;
import java.time.Duration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * 모델 프로브 전용 RestClient 빈 — connect 5s / read 15s(ai-agent 프로브 타임아웃 10s 초과 보장), 무재시도. IssueAiConfig
 * 미러.
 */
@Configuration
public class AssistantModelsConfig {

  @Bean
  public AiAgentModelsClient aiAgentModelsClient(AiAgentProperties props) {
    var builder =
        InternalHttp.restClient(props.baseUrl(), Duration.ofSeconds(5), Duration.ofSeconds(15));
    return new AiAgentModelsClient(builder, props.internalToken());
  }
}
