package com.workplace.user.exception;

public class UserGroupForbiddenException extends RuntimeException {
  public UserGroupForbiddenException(long id, long userId) {
    super("user " + userId + " forbidden to manage user group " + id);
  }
}
