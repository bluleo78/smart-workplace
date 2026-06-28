package com.workplace.user.exception;

/** 관리자가 개인 비서 AGENT 의 이름을 변경하려 할 때 발생(403). 개인 비서는 사용자별 비공개라, 소유자가 자신의 프로필에서만 이름을 바꿀 수 있다. */
public class PersonalAssistantRenameForbiddenException extends RuntimeException {
  public PersonalAssistantRenameForbiddenException(String message) {
    super(message);
  }
}
