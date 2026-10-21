package com.workplace.global.security;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.transaction.CannotCreateTransactionException;

/** 인증 필터 안의 커넥션 획득 실패를 503 재시도 안내로 바꾸는지(WP-751) — 그 밖의 예외는 그대로 던지는지. */
class DbBusyResponseFilterTest {

  private final DbBusyResponseFilter filter = new DbBusyResponseFilter();

  @Test
  void 필터_안에서_커넥션을_못_얻으면_503_한국어_안내를_돌려준다() throws Exception {
    MockHttpServletRequest req = new MockHttpServletRequest("POST", "/api/v1/projects/SEC/issues");
    MockHttpServletResponse res = new MockHttpServletResponse();

    filter.doFilter(
        req,
        res,
        (rq, rs) -> {
          // JwtAuthenticationFilter → PermissionService 트랜잭션 시작 실패를 흉내 낸다.
          throw new IllegalStateException(
              "wrapped",
              new CannotCreateTransactionException("Connection is not available, timed out"));
        });

    assertThat(res.getStatus()).isEqualTo(503);
    assertThat(res.getContentType()).startsWith("application/json");
    assertThat(res.getContentAsString(java.nio.charset.StandardCharsets.UTF_8))
        .contains(DbBusyResponseFilter.MESSAGE)
        .contains("\"path\":\"/api/v1/projects/SEC/issues\"")
        .contains("\"status\":503");
  }

  @Test
  void 다른_예외는_그대로_던진다() {
    MockHttpServletResponse res = new MockHttpServletResponse();
    assertThatThrownBy(
            () ->
                filter.doFilter(
                    new MockHttpServletRequest("GET", "/api/v1/x"),
                    res,
                    (rq, rs) -> {
                      throw new IllegalArgumentException("boom");
                    }))
        .isInstanceOf(IllegalArgumentException.class);
  }
}
