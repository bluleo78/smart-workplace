package com.workplace.global.security;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.global.dto.ErrorResponse;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.security.core.AuthenticationException;
import org.springframework.security.web.AuthenticationEntryPoint;

/**
 * 로그인이 필요한 요청에 401 을 다른 오류와 같은 {@link ErrorResponse} 모양·한국어 문구로 답한다(WP-824).
 *
 * <p>403 대신 401 을 내는 것은 그대로다 — 웹의 토큰 갱신 인터셉터가 401 을 보고 refresh 를 시도한다. 예전에는 Spring Security 기본 영어
 * 문구 「Full authentication is required…」를 문자열로 이어 붙여 JSON 을 만들어(status·errors·path 없음, ISO-8859-1)
 * 화면·AI 가 다른 오류처럼 다룰 수 없었다. 예외 문구는 내부 사정이라 싣지 않는다.
 */
public class JsonAuthenticationEntryPoint implements AuthenticationEntryPoint {

  static final String MESSAGE = "로그인이 필요합니다. 다시 로그인해 주세요.";

  private static final ObjectMapper JSON = new ObjectMapper();

  @Override
  public void commence(
      HttpServletRequest request, HttpServletResponse response, AuthenticationException e)
      throws IOException {
    HttpStatus status = HttpStatus.UNAUTHORIZED;
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
