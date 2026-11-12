package com.workplace.agentaccount.exception;

import com.workplace.global.exception.CodedException;
import java.util.Map;
import org.springframework.http.HttpStatus;

/**
 * Gen:iA 로그인 서버에 로그인을 시작하지 못함(502, WP-1461) — 연결 실패·5xx·해석할 수 없는 응답. 바깥 서버 사정이라 잠시 뒤 다시 시도하게 안내한다.
 * 메시지에는 서버 주소·응답 본문을 싣지 않는다.
 */
public class GeniaLoginUnavailableException extends RuntimeException implements CodedException {

  /** 응답 errors.code — 웹이 사유를 가르는 기준. */
  public static final String CODE = "GENIA_LOGIN_UNAVAILABLE";

  public GeniaLoginUnavailableException() {
    super("Gen:iA 로그인 서버에 연결하지 못했어요. 잠시 뒤 다시 시도해 주세요");
  }

  /** 응답 상태 — 항상 502. */
  @Override
  public HttpStatus status() {
    return HttpStatus.BAD_GATEWAY;
  }

  /** 응답 {@code errors} — 사유 코드 하나. */
  @Override
  public Map<String, String> errors() {
    return Map.of("code", CODE);
  }
}
