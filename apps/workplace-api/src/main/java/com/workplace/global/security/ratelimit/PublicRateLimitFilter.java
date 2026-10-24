package com.workplace.global.security.ratelimit;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.global.dto.ErrorResponse;
import com.workplace.global.net.InternalAddresses;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.net.InetAddress;
import java.net.UnknownHostException;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.regex.Pattern;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.lang.NonNull;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * 인증 없는 공개 경로 중 비밀번호 해시(bcrypt)를 계산하는 요청을 IP 단위로 제한한다(WP-763).
 *
 * <p>계정별 잠금(5회·15분)은 아이디를 바꿔 가며 보내면 걸리지 않아, 요청마다 약 0.1초 CPU 를 쓰는 해시 계산을 대량 요청으로 소모시킬 수 있었다. 대상은
 * 로그인·가입·운영자 로그인({@link Policy#LOGIN})과 비밀번호를 실은 공유 링크 다운로드({@link Policy#SHARE_PASSWORD})다. 넘치면
 * 429 + Retry-After 와 한국어 안내를 돌려준다. CORS 필터 뒤에 두어 브라우저가 응답을 읽을 수 있게 한다.
 *
 * <p>클라이언트 IP: 요청이 내부 대역(인그레스·프록시)에서 왔고 X-Forwarded-For 가 있으면 그 마지막 값(바로 앞 프록시가 붙인 주소)을 쓴다. 바깥에서 보낸
 * X-Forwarded-For 를 그대로 믿지 않도록 내부 대역에서 온 요청에만 적용한다. 루프백에서 온 요청(로컬 도구·테스트)은 제한하지 않는다.
 */
@Slf4j
public class PublicRateLimitFilter extends OncePerRequestFilter {

  /** 넘쳤을 때의 안내 — 화면은 이 문구를 그대로 보인다. */
  static final String MESSAGE = "요청이 너무 많습니다. 잠시 후 다시 시도하세요.";

  private static final ObjectMapper JSON = new ObjectMapper();
  private static final Pattern SHARE_DOWNLOAD =
      Pattern.compile("^/api/v1/public/drive/share/[^/]+/download$");

  /** 제한 정책 — 키 접두와 한도를 고르는 데 쓴다. */
  enum Policy {
    LOGIN,
    SHARE_PASSWORD
  }

  private final TokenBucketLimiter limiter;
  private final RateLimitProperties properties;

  public PublicRateLimitFilter(TokenBucketLimiter limiter, RateLimitProperties properties) {
    this.limiter = limiter;
    this.properties = properties;
  }

  @Override
  protected void doFilterInternal(
      @NonNull HttpServletRequest request,
      @NonNull HttpServletResponse response,
      @NonNull FilterChain chain)
      throws ServletException, IOException {
    Policy policy = properties.enabled() ? policyOf(request) : null;
    String ip = policy == null ? null : clientIp(request);
    if (policy == null || ip == null || isLoopback(ip)) {
      chain.doFilter(request, response);
      return;
    }
    int capacity =
        policy == Policy.LOGIN ? properties.loginPerMinute() : properties.sharePasswordPerMinute();
    long retryAfter = limiter.tryConsume(policy.name() + ":" + ip, capacity);
    if (retryAfter == 0) {
      chain.doFilter(request, response);
      return;
    }
    log.warn("공개 경로 속도 제한 — policy={} ip={} uri={}", policy, ip, request.getRequestURI());
    reject(request, response, retryAfter);
  }

  /** 제한 대상이면 정책, 아니면 null. 공유 다운로드는 비밀번호 헤더가 있을 때만(해시 계산이 있을 때만) 센다. */
  static Policy policyOf(HttpServletRequest request) {
    String uri = request.getRequestURI();
    String method = request.getMethod();
    if ("POST".equals(method)
        && (uri.equals("/api/v1/auth/login")
            || uri.equals("/api/v1/auth/signup")
            || uri.equals("/api/platform/auth/login"))) {
      return Policy.LOGIN;
    }
    if ("GET".equals(method)
        && SHARE_DOWNLOAD.matcher(uri).matches()
        && (request.getHeader("X-Share-Password") != null
            || request.getHeader("X-Share-Password-Encoded") != null)) {
      return Policy.SHARE_PASSWORD;
    }
    return null;
  }

  /** 클라이언트 IP — 내부 대역에서 온 요청이면 X-Forwarded-For 마지막 값, 아니면 접속 주소. */
  static String clientIp(HttpServletRequest request) {
    String remote = request.getRemoteAddr();
    String forwarded = request.getHeader("X-Forwarded-For");
    if (forwarded != null && !forwarded.isBlank() && isInternal(remote)) {
      String[] hops = forwarded.split(",");
      String last = hops[hops.length - 1].trim();
      if (!last.isEmpty()) return last;
    }
    return remote;
  }

  private static boolean isInternal(String ip) {
    try {
      // IP 문자열만 받는다 — 이름이면 조회하지 않고 내부가 아닌 것으로 본다.
      return ip != null
          && isIpLiteral(ip)
          && InternalAddresses.isInternal(InetAddress.getByName(ip));
    } catch (UnknownHostException e) {
      return false;
    }
  }

  private static boolean isLoopback(String ip) {
    try {
      return isIpLiteral(ip) && InetAddress.getByName(ip).isLoopbackAddress();
    } catch (UnknownHostException e) {
      return false;
    }
  }

  /** 숫자·점(IPv4) 또는 콜론이 든(IPv6) 문자열만 IP 로 본다 — getByName 이 DNS 조회를 하지 않게. */
  private static boolean isIpLiteral(String s) {
    return s.contains(":") || s.matches("[0-9.]+");
  }

  private static void reject(
      HttpServletRequest request, HttpServletResponse response, long retryAfter)
      throws IOException {
    HttpStatus status = HttpStatus.TOO_MANY_REQUESTS;
    response.setStatus(status.value());
    response.setHeader("Retry-After", Long.toString(retryAfter));
    response.setContentType(MediaType.APPLICATION_JSON_VALUE);
    response.setCharacterEncoding(StandardCharsets.UTF_8.name());
    JSON.writeValue(
        response.getWriter(),
        new ErrorResponse(
            status.value(),
            status.getReasonPhrase(),
            MESSAGE,
            null,
            Instant.now().toString(),
            request.getRequestURI()));
  }
}
