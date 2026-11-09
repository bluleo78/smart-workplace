package com.workplace.agentruntime.exception;

import java.util.Map;
import org.springframework.http.HttpStatus;

/**
 * Pod 가 올린 로그인을 받지 않음(WP-1450) — 409. 이유 코드({@code errors.reason})는 VERSION_MISMATCH·NOT_CHATGPT·
 * ACCOUNT_MISMATCH·NOT_NEWER·INVALID 중 하나이며, 올린 값은 어떤 문구에도 싣지 않는다.
 */
public class AgentLoginRejectedException extends AgentRuntimeException {

  private final Map<String, String> errors;

  public AgentLoginRejectedException(String reason) {
    super(HttpStatus.CONFLICT, "AGENT_LOGIN_REJECTED", "올린 로그인을 받지 않았습니다: " + reason);
    this.errors = Map.of("code", "AGENT_LOGIN_REJECTED", "reason", reason);
  }

  @Override
  public Map<String, String> errors() {
    return errors;
  }
}
