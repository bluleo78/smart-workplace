package com.workplace.global.exception;

import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.global.dto.ErrorResponse;
import java.lang.reflect.Method;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.core.MethodParameter;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.web.ErrorResponseException;
import org.springframework.web.bind.MissingRequestCookieException;
import org.springframework.web.bind.MissingRequestHeaderException;
import org.springframework.web.bind.UnsatisfiedServletRequestParameterException;

/**
 * 개별 처리기가 없는 Spring 웹 예외가 catch-all 에서 제 상태·헤더로 나가는지(WP-1602).
 *
 * <p>Spring 의 {@link org.springframework.web.ErrorResponse} 를 구현한 예외는 상태 코드와 헤더를 이미 들고 있다. 전에는
 * catch-all 이 이를 보지 않아 400 이어야 할 요청이 500 + ERROR 스택으로 나갔다.
 */
class SpringErrorResponseFallbackTest {

  private final GlobalExceptionHandler handler = new GlobalExceptionHandler();
  private final MockHttpServletRequest request =
      new MockHttpServletRequest("GET", "/api/v1/sample");

  /** MissingRequestHeader/Cookie 예외에 넣을 메서드 인자 — 내용은 쓰이지 않고 이름만 문구에 들어간다. */
  @SuppressWarnings("unused")
  private void sample(String value) {}

  private static MethodParameter param() throws NoSuchMethodException {
    Method m = SpringErrorResponseFallbackTest.class.getDeclaredMethod("sample", String.class);
    return new MethodParameter(m, 0);
  }

  @Test
  void 필수_헤더_누락은_500_이_아니라_400() throws Exception {
    ResponseEntity<ErrorResponse> res =
        handler.handleException(new MissingRequestHeaderException("X-Token", param()), request);
    assertThat(res.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
    assertThat(res.getBody().status()).isEqualTo(400);
    assertThat(res.getBody().message()).contains("X-Token");
  }

  @Test
  void 필수_쿠키_누락은_400() throws Exception {
    ResponseEntity<ErrorResponse> res =
        handler.handleException(new MissingRequestCookieException("sid", param()), request);
    assertThat(res.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
    assertThat(res.getBody().message()).contains("sid");
  }

  @Test
  void 요청_파라미터_조건_불일치는_400() {
    ResponseEntity<ErrorResponse> res =
        handler.handleException(
            new UnsatisfiedServletRequestParameterException(
                new String[] {"mode=a"}, Map.of("mode", new String[] {"b"})),
            request);
    assertThat(res.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
  }

  @Test
  void 예외가_든_헤더도_응답에_싣는다() {
    // 405 의 Allow 처럼 Spring 예외가 정한 헤더를 그대로 내보낸다.
    ErrorResponseException ex = new ErrorResponseException(HttpStatus.METHOD_NOT_ALLOWED);
    ex.getHeaders().add(HttpHeaders.ALLOW, "GET, POST");
    ResponseEntity<ErrorResponse> res = handler.handleException(ex, request);
    assertThat(res.getStatusCode()).isEqualTo(HttpStatus.METHOD_NOT_ALLOWED);
    assertThat(res.getHeaders().getFirst(HttpHeaders.ALLOW)).isEqualTo("GET, POST");
  }

  @Test
  void 상태를_선언하지_않은_예외는_여전히_500() {
    ResponseEntity<ErrorResponse> res =
        handler.handleException(new IllegalStateException("boom"), request);
    assertThat(res.getStatusCode()).isEqualTo(HttpStatus.INTERNAL_SERVER_ERROR);
    assertThat(res.getBody().message()).isEqualTo("An unexpected error occurred");
  }
}
