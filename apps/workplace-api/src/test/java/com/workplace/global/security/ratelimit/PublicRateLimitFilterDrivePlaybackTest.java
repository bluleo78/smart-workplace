package com.workplace.global.security.ratelimit;

import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.drive.service.DrivePlaybackService;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockFilterChain;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

/**
 * 드라이브 재생 주소 속도 제한(WP-1532) — 아바타 테스트와 같이 작은 한도(3)·고정 시계로 필터를 직접 만들어 본다. 같은 IP·같은 주소의 범위 요청을
 * GET·HEAD 함께 세고, 주소가 다르거나 IP 가 다르면 따로 센다(NAT 뒤 여러 사람이 각자 영상을 봐도 한도를 나눠 쓰지 않는다).
 */
class PublicRateLimitFilterDrivePlaybackTest {

  private static final int LIMIT = 3;
  private static final String A = DrivePlaybackService.PUBLIC_PATH + "tokenA";
  private static final String B = DrivePlaybackService.PUBLIC_PATH + "tokenB";

  private final PublicRateLimitFilter filter =
      new PublicRateLimitFilter(
          new TokenBucketLimiter(
              Clock.fixed(Instant.parse("2026-01-01T00:00:00Z"), ZoneOffset.UTC)),
          new RateLimitProperties(true, null, null, null, LIMIT));

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
  void 같은_IP_같은_주소는_한도를_넘기면_429_다른_주소와_IP_는_따로_센다() throws Exception {
    String ip = "203.0.113.20";
    assertThat(send("GET", A, ip)).isEqualTo(200);
    assertThat(send("HEAD", A, ip)).isEqualTo(200);
    assertThat(send("GET", A, ip)).isEqualTo(200);
    assertThat(send("GET", A, ip)).isEqualTo(429);
    assertThat(send("GET", B, ip)).as("다른 재생 주소").isEqualTo(200);
    assertThat(send("GET", A, "203.0.113.21")).as("다른 IP").isEqualTo(200);
  }

  @Test
  void 기본_한도는_탐색의_범위_요청을_넉넉히_받는다() {
    assertThat(new RateLimitProperties(null, null, null, null, null).drivePlaybackPerMinute())
        .isEqualTo(300);
  }

  @Test
  void 루프백과_발급_API_는_세지_않는다() throws Exception {
    for (int i = 0; i < LIMIT + 2; i++) {
      assertThat(send("GET", A, null)).isEqualTo(200);
      assertThat(send("POST", "/api/v1/drive/files/1/playback-url", "203.0.113.22")).isEqualTo(200);
    }
  }
}
