package com.workplace.auth.outbound;

import com.workplace.global.outbound.AiAgentProperties;
import com.workplace.global.outbound.InternalHttp;
import java.time.Duration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * 모델 프로브 전용 RestClient 빈 — connect 5s / read 15s(ai-agent 프로브 타임아웃 10s 초과 보장), 무재시도. IssueAiConfig
 * 미러. 등록 확인(WP-1496)은 등록 트랜잭션 안에서 불리므로 read 5s 인 클라이언트를 따로 쓴다 — 늦으면 확인 못 함으로 보고 저장한다.
 */
@Configuration
public class AssistantModelsConfig {

  @Bean
  public AiAgentModelsClient aiAgentModelsClient(AiAgentProperties props) {
    var builder =
        InternalHttp.restClient(props.baseUrl(), Duration.ofSeconds(5), Duration.ofSeconds(15));
    // WP-1496: 등록 확인용 — 연결 2s / 응답 5s. DB 연결을 잡은 채 오래 기다리지 않는다.
    var checkBuilder =
        InternalHttp.restClient(props.baseUrl(), Duration.ofSeconds(2), Duration.ofSeconds(5));
    return new AiAgentModelsClient(builder, checkBuilder, props.internalToken());
  }
}
