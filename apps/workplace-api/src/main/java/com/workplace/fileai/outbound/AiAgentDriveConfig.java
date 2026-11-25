package com.workplace.fileai.outbound;

import com.workplace.airun.AiCall;
import com.workplace.airun.AiCallTimeouts;
import com.workplace.airun.outbound.AiAgentHttp;
import com.workplace.global.outbound.AiAgentProperties;
import java.time.Duration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * 드라이브 AI 요약·보안 검사 전용 RestClient 빈. connect 5s / read 는 요약·보안 검사 실행 상한 중 큰 값 + 여유(WP-2111) —
 * ai-agent 예산을 반드시 초과해야 한다(MailAiConfig 패턴 미러).
 *
 * <p>AiAgentProperties(workplace.ai-agent.*) 를 재사용하므로 별도 설정 키가 필요 없다.
 */
@Configuration
public class AiAgentDriveConfig {

  /** 기존 고정 read 상한(200초) — 상한 표가 이보다 작아도 내리지 않는다. */
  private static final Duration MIN_READ_TIMEOUT = Duration.ofSeconds(200);

  /**
   * 드라이브 클라이언트의 read 상한 — 요약·보안 검사(덮어쓰기 8분까지) 실행 상한 + 여유와 기존 200초 중 큰 값. 이 클라이언트는 요약과 노트·파일 보안 검사가
   * 함께 쓴다.
   */
  static Duration readTimeout(AiCallTimeouts timeouts) {
    return timeouts.readTimeoutAtLeast(
        MIN_READ_TIMEOUT, AiCall.DRIVE_SUMMARIZE, AiCall.DRIVE_SECURITY_CHECK);
  }

  /** 드라이브 전용 RestClient 를 구성한다. read timeout 은 {@link #readTimeout}. */
  @Bean
  public AiAgentDriveClient aiAgentDriveClient(
      AiAgentProperties props, AiAgentHttp aiAgentHttp, AiCallTimeouts timeouts) {
    var restClient =
        aiAgentHttp
            .restClient(props.baseUrl(), Duration.ofSeconds(5), readTimeout(timeouts))
            .build();
    return new AiAgentDriveClient(restClient, props.internalToken());
  }
}
