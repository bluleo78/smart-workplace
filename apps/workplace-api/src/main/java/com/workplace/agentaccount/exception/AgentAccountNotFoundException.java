package com.workplace.agentaccount.exception;

import com.workplace.global.exception.CodedException;
import java.util.Map;
import org.springframework.http.HttpStatus;

/**
 * AI 계정이 없음(404, WP-1448) — 없는 id, 이미 폐기된 계정, 다른 워크스페이스의 계정을 모두 같은 「없음」으로 본다. 다른 워크스페이스 계정이 있는지조차
 * 드러내지 않기 위해서다.
 */
public class AgentAccountNotFoundException extends RuntimeException implements CodedException {

  /** 응답 errors.code — 웹이 사유를 가르는 기준. */
  public static final String CODE = "AGENT_ACCOUNT_NOT_FOUND";

  public AgentAccountNotFoundException() {
    super("AI 계정을 찾을 수 없어요");
  }

  /** 응답 상태 — 항상 404. */
  @Override
  public HttpStatus status() {
    return HttpStatus.NOT_FOUND;
  }

  /** 응답 {@code errors} — 사유 코드 하나. */
  @Override
  public Map<String, String> errors() {
    return Map.of("code", CODE);
  }
}
