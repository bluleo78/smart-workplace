package com.workplace.global.security.ratelimit;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * 인증 없는 공개 경로의 IP 단위 속도 제한 설정(WP-763). {@code app.rate-limit} 로 바인딩한다.
 *
 * @param enabled 끄면 제한하지 않는다(기본 켜짐)
 * @param loginPerMinute 로그인·가입·운영자 로그인 — 같은 IP 에서 1분에 받는 횟수(기본 20)
 * @param sharePasswordPerMinute 비밀번호가 걸린 공유 링크 다운로드 — 같은 IP 에서 1분에 받는 횟수(기본 10)
 */
@ConfigurationProperties(prefix = "app.rate-limit")
public record RateLimitProperties(
    Boolean enabled, Integer loginPerMinute, Integer sharePasswordPerMinute) {

  /** 값이 비면 기본값으로 채운다 — application.yml 에 키가 없어도 켜진 채 기본 한도로 돈다. */
  public RateLimitProperties {
    if (enabled == null) enabled = true;
    if (loginPerMinute == null) loginPerMinute = 20;
    if (sharePasswordPerMinute == null) sharePasswordPerMinute = 10;
  }
}
