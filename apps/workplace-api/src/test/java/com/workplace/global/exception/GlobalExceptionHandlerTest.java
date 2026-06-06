package com.workplace.global.exception;

import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.global.dto.ErrorResponse;
import java.io.IOException;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.mock.web.MockHttpServletRequest;

/**
 * GlobalExceptionHandler 단위 테스트 — 클라이언트 연결 종료(Broken pipe 등) 노이즈 억제 검증.
 *
 * <p>의존성이 없는 @RestControllerAdvice 라 Spring 컨텍스트 없이 직접 인스턴스화한다.
 */
class GlobalExceptionHandlerTest {

  private final GlobalExceptionHandler handler = new GlobalExceptionHandler();
  private final MockHttpServletRequest request =
      new MockHttpServletRequest("GET", "/api/v1/messaging/stream");

  @Test
  void brokenPipe_는_무시되어_null_을_반환한다() {
    // SSE 스트림에 쓰다 클라이언트가 끊긴 경우 — ErrorResponse 직렬화를 시도하지 않는다.
    assertThat(handler.handleException(new IOException("Broken pipe"), request)).isNull();
  }

  @Test
  void 원인체인에_brokenPipe_가_있어도_무시한다() {
    Exception ex = new IllegalStateException("wrap", new IOException("Broken pipe"));
    assertThat(handler.handleException(ex, request)).isNull();
  }

  @Test
  void connectionReset_도_무시한다() {
    assertThat(handler.handleException(new IOException("Connection reset by peer"), request))
        .isNull();
  }

  @Test
  void 일반_예외는_500_을_반환한다() {
    ResponseEntity<ErrorResponse> res =
        handler.handleException(new RuntimeException("boom"), request);
    assertThat(res).isNotNull();
    assertThat(res.getStatusCode()).isEqualTo(HttpStatus.INTERNAL_SERVER_ERROR);
    assertThat(res.getBody()).isNotNull();
  }
}
