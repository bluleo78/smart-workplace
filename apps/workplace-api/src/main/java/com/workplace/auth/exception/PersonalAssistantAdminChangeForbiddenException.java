package com.workplace.auth.exception;

import com.workplace.global.exception.CodedException;
import java.util.Map;
import org.springframework.http.HttpStatus;

/**
 * 관리자가 구성원의 개인 비서를 공통 비서로 지정하거나 그 AI 연결을 등록·재발급하려 할 때 발생(403, WP-1163). 개인 비서는 주인의 자격증명으로 주인만을 위해
 * 움직여, 관리자가 바꾸면 주인 모르게 그 토큰으로 모두의 대화가 돌거나 주인의 대화가 관리자 연결로 나간다 — 키 발급(WP-1153)·이름 변경·삭제 차단과 같은 규칙.
 * 응답은 {@link CodedException} 공통 처리기가 만든다.
 */
public class PersonalAssistantAdminChangeForbiddenException extends RuntimeException
    implements CodedException {
  public PersonalAssistantAdminChangeForbiddenException(String message) {
    super(message);
  }

  @Override
  public HttpStatus status() {
    return HttpStatus.FORBIDDEN;
  }

  @Override
  public Map<String, String> errors() {
    return null;
  }
}
