package com.workplace.messaging.exception;

/** 잘못된 DM 생성 요청(빈 타겟·self-only·>8명·미존재 유저). → 400. */
public class InvalidDmRequestException extends RuntimeException {
  public InvalidDmRequestException(String message) {
    super(message);
  }
}
