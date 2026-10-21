package com.workplace.user.exception;

/** 관리자가 개인 비서 AGENT 를 삭제하려 할 때 발생(403, WP-705). 개인 비서는 사용자별 비공개라 소유자의 것이고, 소유자의 사용자 행이 가리키고 있다. */
public class PersonalAssistantDeleteForbiddenException extends RuntimeException {
  public PersonalAssistantDeleteForbiddenException(String message) {
    super(message);
  }
}
