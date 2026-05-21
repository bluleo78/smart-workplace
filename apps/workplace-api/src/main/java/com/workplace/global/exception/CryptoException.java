package com.workplace.global.exception;

/** 암호/해시 처리 중 발생하는 일반 오류. */
public class CryptoException extends RuntimeException {
  public CryptoException(String message) {
    super(message);
  }

  public CryptoException(String message, Throwable cause) {
    super(message, cause);
  }
}
