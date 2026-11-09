package com.workplace.agentaccount.usage;

import java.time.Duration;
import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * AI 계정 사용량 조회 설정(workplace.agent-account.usage). 값은 application.yml 이 정하고, 누락 시 아래 기본값으로 보정한다.
 *
 * @param enabled 조회 스케줄 사용 여부
 * @param interval 한 계정을 다시 조회하는 최소 간격이자 스케줄 주기
 * @param claudeModel Claude 헤더 조회용 최소 호출 모델
 * @param nearLimitPercent 임박 판정 사용률(%)
 * @param anthropicBaseUrl Anthropic API 주소
 * @param chatgptBaseUrl ChatGPT 주소
 * @param connectTimeout 연결 타임아웃
 * @param readTimeout 응답 타임아웃
 * @param lease 조회 임대 시간
 */
@ConfigurationProperties("workplace.agent-account.usage")
public record AgentAccountUsageProperties(
    boolean enabled,
    Duration interval,
    String claudeModel,
    Integer nearLimitPercent,
    String anthropicBaseUrl,
    String chatgptBaseUrl,
    Duration connectTimeout,
    Duration readTimeout,
    Duration lease) {

  /** 누락된 값을 기본값으로 채운다. */
  public AgentAccountUsageProperties {
    if (interval == null) interval = Duration.ofMinutes(10);
    if (claudeModel == null || claudeModel.isBlank()) claudeModel = "claude-haiku-4-5";
    if (nearLimitPercent == null) nearLimitPercent = 75;
    if (anthropicBaseUrl == null || anthropicBaseUrl.isBlank())
      anthropicBaseUrl = "https://api.anthropic.com";
    if (chatgptBaseUrl == null || chatgptBaseUrl.isBlank()) chatgptBaseUrl = "https://chatgpt.com";
    if (connectTimeout == null) connectTimeout = Duration.ofSeconds(5);
    if (readTimeout == null) readTimeout = Duration.ofSeconds(15);
    if (lease == null) lease = Duration.ofMinutes(2);
  }
}
