package com.workplace.user.exception;

/** SHARED 그룹을 user-group:manage 권한 없이 변경 시도 시 → 403. */
public class UserGroupForbiddenException extends RuntimeException {
  public UserGroupForbiddenException(long id, long userId) {
    super("user " + userId + " forbidden to manage user group " + id);
  }
}
