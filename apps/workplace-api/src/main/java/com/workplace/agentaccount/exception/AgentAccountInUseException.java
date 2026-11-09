package com.workplace.agentaccount.exception;

import com.workplace.global.exception.CodedException;
import java.util.Map;
import org.springframework.http.HttpStatus;

/**
 * 쓰는 AI 가 있는 계정은 폐기할 수 없음(409, WP-1448) — 폐기된 계정을 가리킨 Pod 가 조용히 로그인 정보를 잃지 않도록, 먼저 그 AI 들을 다른 계정으로
 * 옮기게 한다.
 */
public class AgentAccountInUseException extends RuntimeException implements CodedException {

  /** 응답 errors.code — 웹이 사유를 가르는 기준. */
  public static final String CODE = "AGENT_ACCOUNT_IN_USE";

  public AgentAccountInUseException() {
    super("이 계정을 쓰는 AI 가 있어요 — AI 를 다른 계정으로 옮긴 뒤 폐기해 주세요");
  }

  /** 응답 상태 — 항상 409. */
  @Override
  public HttpStatus status() {
    return HttpStatus.CONFLICT;
  }

  /** 응답 {@code errors} — 사유 코드 하나. */
  @Override
  public Map<String, String> errors() {
    return Map.of("code", CODE);
  }
}
