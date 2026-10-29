package com.workplace.global.util;

import jakarta.servlet.http.HttpServletRequest;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

/**
 * 감사 로그에 남길 요청 정보(클라이언트 IP·User-Agent). IP 는 {@link ClientIpExtractor} 로 뽑아 감사 열 길이로 자른다.
 *
 * <p>WP-1161: 전에는 감사 서비스·일반 로그인·운영자 로그인·로그인 실패 감사가 저마다 뽑아, 로그인 행만 IP 를 자르지 않거나(긴 X-Forwarded-For 면
 * INSERT 실패) 배열 순서에 기대는 등 결과가 서로 달랐다. 한 곳에서 같은 규칙으로 뽑는다.
 */
public record RequestInfo(String ip, String userAgent) {

  /** 요청 밖(스케줄러·비동기 풀)에서 쓰는 빈 값. */
  private static final RequestInfo NONE = new RequestInfo(null, null);

  /** 지금 스레드가 처리 중인 HTTP 요청의 정보. 요청 밖이면 둘 다 null. */
  public static RequestInfo current() {
    if (RequestContextHolder.getRequestAttributes() instanceof ServletRequestAttributes attrs) {
      return of(attrs.getRequest());
    }
    return NONE;
  }

  /** 주어진 요청의 정보. */
  private static RequestInfo of(HttpServletRequest req) {
    return new RequestInfo(
        ClientIpExtractor.forAudit(ClientIpExtractor.extract(req)), req.getHeader("User-Agent"));
  }
}
