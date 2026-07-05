package com.workplace.role.exception;

/** 역할이 1명 이상의 사용자에게 할당된 상태에서 삭제를 시도할 때 발생 (#678). */
public class RoleAssignedException extends RuntimeException {
  public RoleAssignedException(String message) {
    super(message);
  }
}
