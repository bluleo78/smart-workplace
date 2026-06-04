package com.workplace.user.exception;

public class UserGroupNotFoundException extends RuntimeException {
  public UserGroupNotFoundException(long id) {
    super("user group " + id + " not found");
  }
}
