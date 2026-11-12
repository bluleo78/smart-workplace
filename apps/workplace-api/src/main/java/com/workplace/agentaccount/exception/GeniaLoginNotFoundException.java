package com.workplace.agentaccount.exception;

import com.workplace.global.exception.CodedException;
import java.util.Map;
import org.springframework.http.HttpStatus;

/**
 * Gen:iA 브라우저 로그인 진행이 없음(404, WP-1461) — 없는 id, 끝나고 정리된 진행, API 재시작으로 사라진 진행, 남의 진행·다른 워크스페이스의 진행을
 * 모두 같은 「없음」으로 본다. 웹은 이 응답을 「만료」와 같은 화면(다시 시도)으로 보인다.
 */
public class GeniaLoginNotFoundException extends RuntimeException implements CodedException {

  /** 응답 errors.code — 웹이 사유를 가르는 기준. */
  public static final String CODE = "GENIA_LOGIN_NOT_FOUND";

  public GeniaLoginNotFoundException() {
    super("Gen:iA 로그인 진행을 찾을 수 없어요");
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
