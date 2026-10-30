package com.workplace.global.security.ratelimit;

import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.user.service.AvatarService;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockFilterChain;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

/**
 * 공개 아바타 속도 제한(WP-1222) — 필터를 작은 한도(3)로 직접 만들어 본다. 운영 한도(1200/분)를 통합 테스트에서 채우려면 요청이 너무 많고, 테스트 설정
 * 전체의 한도를 낮추거나 이 테스트만 속성을 바꿔 스프링 컨텍스트를 하나 더 띄우지 않으려는 것이다. 보안 필터 체인 배선(429·Retry-After 응답)은 {@link
 * PublicRateLimitFilterTest} 가 로그인·공유 경로로 본다. 시계는 고정이라 버킷이 다시 차지 않는다.
 */
class PublicRateLimitFilterAvatarTest {

  private static final int LIMIT = 3;
  private static final String IMAGE = AvatarService.PUBLIC_PATH + "/999999/0123456789abcdef0123/64";

  private final PublicRateLimitFilter filter =
      new PublicRateLimitFilter(
          new TokenBucketLimiter(
              Clock.fixed(Instant.parse("2026-01-01T00:00:00Z"), ZoneOffset.UTC)),
          new RateLimitProperties(true, null, null, LIMIT));

  /** 내부 대역(프록시)에서 X-Forwarded-For 로 클라이언트 IP 를 실어 보낸다. forwardedFor 가 null 이면 루프백에서 직접. */
  private int send(String method, String uri, String forwardedFor) throws Exception {
    MockHttpServletRequest req = new MockHttpServletRequest(method, uri);
    if (forwardedFor != null) {
      req.setRemoteAddr("10.0.0.5");
      req.addHeader("X-Forwarded-For", forwardedFor);
    }
    MockHttpServletResponse res = new MockHttpServletResponse();
    filter.doFilter(req, res, new MockFilterChain());
    return res.getStatus();
  }

  @Test
  void 같은_IP_의_아바타_요청은_GET_과_HEAD_를_함께_세어_한도를_넘기면_429() throws Exception {
    String ip = "203.0.113.10";
    assertThat(send("GET", IMAGE, ip)).isEqualTo(200);
    assertThat(send("HEAD", IMAGE, ip)).isEqualTo(200);
    assertThat(send("GET", AvatarService.PUBLIC_PATH + "/1/x/64", ip))
        .as("404 가 될 잘못된 주소도 센다")
        .isEqualTo(200);
    assertThat(send("HEAD", IMAGE, ip)).isEqualTo(429);
    assertThat(send("GET", IMAGE, ip)).isEqualTo(429);
    // 다른 IP 는 따로 센다.
    assertThat(send("GET", IMAGE, "203.0.113.11")).isEqualTo(200);
  }

  @Test
  void 루프백_요청과_아바타가_아닌_경로_다른_메서드는_세지_않는다() throws Exception {
    for (int i = 0; i < LIMIT + 2; i++) {
      assertThat(send("GET", IMAGE, null)).isEqualTo(200);
      assertThat(send("GET", "/api/v1/users/avatars", "203.0.113.12")).isEqualTo(200);
      assertThat(send("POST", IMAGE, "203.0.113.12")).isEqualTo(200);
    }
  }
}
