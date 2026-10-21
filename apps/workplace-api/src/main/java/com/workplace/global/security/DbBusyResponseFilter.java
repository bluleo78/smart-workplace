package com.workplace.global.security;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.global.dto.ErrorResponse;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.lang.NonNull;
import org.springframework.transaction.CannotCreateTransactionException;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * 인증 필터 안에서 DB 커넥션을 못 얻은 요청을 503 「잠시 후 다시」로 돌려준다(WP-751).
 *
 * <p>컨트롤러 밖(JWT·API 키·사용자 토큰 필터의 권한·멤버십 조회)에서 난 예외는 {@code @ControllerAdvice} 를 거치지 않아 풀이 바닥났을 때 사유
 * 없는 기본 500 이 나갔다. 컨트롤러 안에서 같은 상황은 GlobalExceptionHandler 가 503 + 재시도 안내로 내므로 같은 응답으로 맞춘다. CORS 필터
 * 뒤에 두어 브라우저가 응답을 읽을 수 있게 한다. 다른 예외는 그대로 던진다.
 */
@Slf4j
public class DbBusyResponseFilter extends OncePerRequestFilter {

  /** GlobalExceptionHandler.handleCannotCreateTransaction 과 같은 문구. */
  static final String MESSAGE = "서버가 일시적으로 혼잡합니다. 잠시 후 다시 시도해주세요.";

  private static final ObjectMapper JSON = new ObjectMapper();

  @Override
  protected void doFilterInternal(
      @NonNull HttpServletRequest request,
      @NonNull HttpServletResponse response,
      @NonNull FilterChain chain)
      throws ServletException, IOException {
    try {
      chain.doFilter(request, response);
    } catch (RuntimeException | ServletException e) {
      if (!causedByNoConnection(e) || response.isCommitted()) throw e;
      log.warn("DB 커넥션 획득 실패(필터) — 요청 거부: {}", e.getMessage());
      HttpStatus status = HttpStatus.SERVICE_UNAVAILABLE;
      response.resetBuffer();
      response.setStatus(status.value());
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

  private static boolean causedByNoConnection(Throwable e) {
    for (Throwable t = e; t != null; t = t.getCause()) {
      if (t instanceof CannotCreateTransactionException) return true;
    }
    return false;
  }
}
