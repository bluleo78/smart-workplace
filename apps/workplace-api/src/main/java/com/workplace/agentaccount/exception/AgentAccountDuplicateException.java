package com.workplace.agentaccount.exception;

import com.workplace.global.exception.CodedException;
import java.util.Map;
import org.springframework.http.HttpStatus;

/**
 * 같은 키(같은 종류·같은 지문)의 살아 있는 계정이 이미 있음(409, WP-1448). 같은 ChatGPT 로그인을 두 계정으로 두면 한쪽 갱신이 다른 쪽 로그인을 풀어
 * 버리므로(갱신 토큰 1회용) 하나만 두게 한다. DB 유일 인덱스(tenant_id, provider, fingerprint) 위반이 500 으로 새지 않도록 서비스가 먼저
 * 막는다.
 */
public class AgentAccountDuplicateException extends RuntimeException implements CodedException {

  /** 응답 errors.code — 웹이 사유를 가르는 기준. */
  public static final String CODE = "AGENT_ACCOUNT_DUPLICATE";

  public AgentAccountDuplicateException() {
    super("같은 키의 계정이 이미 있어요 — 목록의 그 계정을 써 주세요");
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
