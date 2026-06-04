package com.workplace.user.exception;

/** 부모 사이클·잘못된 멤버 대상 등 잘못된 그룹 요청 시 → 400. */
public class InvalidUserGroupException extends RuntimeException {
  public InvalidUserGroupException(String message) {
    super(message);
  }
}
