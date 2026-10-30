package com.workplace.global.security.ratelimit;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * 인증 없는 공개 경로의 IP 단위 속도 제한 설정(WP-763). {@code app.rate-limit} 로 바인딩한다.
 *
 * @param enabled 끄면 제한하지 않는다(기본 켜짐)
 * @param loginPerMinute 로그인·가입·운영자 로그인 — 같은 IP 에서 1분에 받는 횟수(기본 20)
 * @param sharePasswordPerMinute 비밀번호가 걸린 공유 링크 다운로드 — 같은 IP 에서 1분에 받는 횟수(기본 10)
 * @param avatarPerMinute 공개 아바타 이미지(WP-1222) — 같은 IP 에서 1분에 받는 횟수(기본 1200). 넉넉하게 둔 이유: 채널·구성원 목록 한
 *     화면이 처음(캐시 없이) 열릴 때 수십~백여 명의 아바타를 한꺼번에 받고, 회사 NAT 뒤에서는 여러 사람이 IP 하나를 나눠 쓴다. 이미지는 주소가 바뀌지 않는 한
 *     브라우저가 영구 캐시(immutable)하므로 정상 사용은 한도에 거의 닿지 않고, 주소를 바꿔 가며 두드리는 요청만 막힌다.
 */
@ConfigurationProperties(prefix = "app.rate-limit")
public record RateLimitProperties(
    Boolean enabled,
    Integer loginPerMinute,
    Integer sharePasswordPerMinute,
    Integer avatarPerMinute) {

  /** 값이 비면 기본값으로 채운다 — application.yml 에 키가 없어도 켜진 채 기본 한도로 돈다. */
  public RateLimitProperties {
    if (enabled == null) enabled = true;
    if (loginPerMinute == null) loginPerMinute = 20;
    if (sharePasswordPerMinute == null) sharePasswordPerMinute = 10;
    if (avatarPerMinute == null) avatarPerMinute = 1200;
  }
}
