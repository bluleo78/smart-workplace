package com.workplace.auth.exception;

/**
 * 관리자가 개인 비서에게 API 키를 발급하려 할 때 발생(403, WP-1153). 개인 비서는 주인의 위임으로만 움직여, 관리자가 키를 받으면 주인의 개인 작업을 읽을 수
 * 있다 — 이름 변경·삭제 차단과 같은 규칙.
 */
public class PersonalAssistantKeyIssueForbiddenException extends RuntimeException {
  public PersonalAssistantKeyIssueForbiddenException() {
    super("개인 비서의 API 키는 관리자가 발급할 수 없습니다");
  }
}
