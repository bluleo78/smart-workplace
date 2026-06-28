package com.workplace.fileai.outbound;

import com.workplace.global.outbound.AiAgentProperties;
import java.time.Duration;
import org.springframework.boot.http.client.ClientHttpRequestFactoryBuilder;
import org.springframework.boot.http.client.ClientHttpRequestFactorySettings;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.client.RestClient;

/**
 * 드라이브 AI 요약 전용 RestClient 빈. connect 5s / read 200s — ai-agent 드라이브 요약은 최대 180s 예산이므로 read timeout
 * 은 이를 반드시 초과해야 한다(MailAiConfig 패턴 미러).
 *
 * <p>AiAgentProperties(workplace.ai-agent.*) 를 재사용하므로 별도 설정 키가 필요 없다.
 */
@Configuration
public class AiAgentDriveConfig {

  /**
   * 드라이브 요약 전용 RestClient 를 구성한다.
   *
   * <p>read timeout 200s: ai-agent 드라이브 요약 예산(최대 180s)보다 여유 있게 설정해 느리지만 성공한 요청이 api 측에서 먼저 끊기는 현상을
   * 방지한다.
   */
  @Bean
  public AiAgentDriveClient aiAgentDriveClient(AiAgentProperties props) {
    var settings =
        ClientHttpRequestFactorySettings.defaults()
            .withConnectTimeout(Duration.ofSeconds(5))
            .withReadTimeout(Duration.ofSeconds(200));
    var factory = ClientHttpRequestFactoryBuilder.detect().build(settings);
    var restClient = RestClient.builder().baseUrl(props.baseUrl()).requestFactory(factory).build();
    return new AiAgentDriveClient(restClient, props.internalToken());
  }
}
