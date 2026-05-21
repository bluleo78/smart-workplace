package com.workplace.user.exception;

public class UserDeactivatedException extends RuntimeException {
  public UserDeactivatedException(String message) {
    super(message);
  }
}
