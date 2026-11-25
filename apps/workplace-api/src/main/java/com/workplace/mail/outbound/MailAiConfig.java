package com.workplace.mail.outbound;

import com.workplace.airun.AiCall;
import com.workplace.airun.AiCallTimeouts;
import com.workplace.airun.outbound.AiAgentHttp;
import com.workplace.global.outbound.AiAgentProperties;
import java.time.Duration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/** 메일 AI 전용 RestClient 빈 — connect 5s / read 는 상한 표 기준(ai-agent 예산 초과 보장), 무재시도. */
@Configuration
public class MailAiConfig {

  /** 메일 클라이언트가 나르는 AI 호출 종류 — read 상한은 이 중 가장 긴 실행 상한을 덮어야 한다. 메일 호출 지점 8개 전부(WP-2111). */
  static final AiCall[] CALLS = {
    AiCall.MAIL_ANALYZE_CONTENT,
    AiCall.MAIL_CLASSIFY_BATCH,
    AiCall.MAIL_ANALYZE_PERSONAL,
    AiCall.MAIL_LEARN_CATEGORY,
    AiCall.MAIL_REPLY_DRAFT,
    AiCall.MAIL_COMPOSE_DRAFT,
    AiCall.MAIL_DRAFT_COACHING,
    AiCall.MAIL_ISSUE_DRAFT
  };

  /**
   * 메일 클라이언트의 read 상한 — 메일 호출 상한의 최대 + 여유. 덮어쓰기로 상한이 커지면 같이 커진다. 메일 스케줄러의 회차 시간 예산도 호출 하나의 최악을 이
   * 값으로 센다(WP-2111 — 같은 클라이언트가 다른 항목 때문에 더 오래 기다릴 수 있어서).
   */
  public static Duration readTimeout(AiCallTimeouts timeouts) {
    return timeouts.readTimeoutFor(CALLS);
  }

  /**
   * 메일 AI 전용 RestClient 를 구성한다.
   *
   * <p>connect 5s / read 는 {@link #readTimeout} — read timeout 은 ai-agent 의 CLI 예산을 반드시 초과해야 한다.
   * 같으면 CLI 가 풀-런 후 파싱·응답을 마치기 전에 api 측이 먼저 끊어, 느리지만 성공한 요청이 잘릴 수 있다. 재시도 로직은 두지 않는다(무재시도). Spring
   * Boot 3.4 의 비-deprecated API({@code org.springframework.boot.http.client.*}) 로 팩토리를 생성한다.
   */
  @Bean
  public AiAgentMailClient aiAgentMailClient(
      AiAgentProperties props, AiAgentHttp aiAgentHttp, AiCallTimeouts timeouts) {
    var builder =
        aiAgentHttp.restClient(props.baseUrl(), Duration.ofSeconds(5), readTimeout(timeouts));
    return new AiAgentMailClient(builder, props.internalToken());
  }
}
