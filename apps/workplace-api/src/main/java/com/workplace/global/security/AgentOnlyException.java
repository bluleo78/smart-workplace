package com.workplace.global.security;

import com.workplace.global.exception.CodedException;
import java.util.Map;
import org.springframework.http.HttpStatus;

/**
 * {@link RequireAgent} API 를 AI 키가 아닌 인증(사람 로그인·개인 토큰 등)으로 부르면 403(WP-1286). 코드는 엔드포인트와 무관하게 {@code
 * AGENT_ONLY} 하나다 — 계약은 docs/integrations/agent-runner-api.md.
 */
public class AgentOnlyException extends RuntimeException implements CodedException {

  /** 응답 {@code errors.code}. */
  public static final String CODE = "AGENT_ONLY";

  public AgentOnlyException() {
    super("AI 키로만 부를 수 있는 API 입니다");
  }

  @Override
  public HttpStatus status() {
    return HttpStatus.FORBIDDEN;
  }

  @Override
  public Map<String, String> errors() {
    return Map.of("code", CODE);
  }
}
