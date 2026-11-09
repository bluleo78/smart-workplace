package com.workplace.agentaccount.refresh;

import java.time.Duration;
import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * ChatGPT 로그인 서버 갱신 설정(workplace.agent-account.login-refresh, WP-1450). 값은 application.yml 이 정하고,
 * 누락 시 아래 기본값으로 보정한다.
 *
 * @param enabled 갱신 스케줄 사용 여부
 * @param interval 스케줄 주기
 * @param refreshBefore access token 만료(exp) 이만큼 전부터 갱신한다
 * @param tokenUrl 갱신 요청 주소(Codex 의 REFRESH_TOKEN_URL)
 * @param connectTimeout 연결 타임아웃
 * @param readTimeout 응답 타임아웃
 * @param lease 한 계정의 갱신 임대 시간(여러 대가 같은 계정을 동시에 갱신하지 않게)
 */
@ConfigurationProperties("workplace.agent-account.login-refresh")
public record LoginRefreshProperties(
    boolean enabled,
    Duration interval,
    Duration refreshBefore,
    String tokenUrl,
    Duration connectTimeout,
    Duration readTimeout,
    Duration lease) {

  /** 누락된 값을 기본값으로 채운다. */
  public LoginRefreshProperties {
    if (interval == null) interval = Duration.ofHours(1);
    if (refreshBefore == null) refreshBefore = Duration.ofDays(5);
    if (tokenUrl == null || tokenUrl.isBlank()) tokenUrl = "https://auth.openai.com/oauth/token";
    if (connectTimeout == null) connectTimeout = Duration.ofSeconds(5);
    if (readTimeout == null) readTimeout = Duration.ofSeconds(15);
    if (lease == null) lease = Duration.ofMinutes(2);
  }
}
