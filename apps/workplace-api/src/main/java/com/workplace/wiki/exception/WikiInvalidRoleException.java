package com.workplace.wiki.exception;

public class WikiInvalidRoleException extends RuntimeException {
  public WikiInvalidRoleException(String role) {
    super("유효하지 않은 역할: " + role);
  }
}
