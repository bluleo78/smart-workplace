package com.workplace.messaging.exception;

/** 잘못된 DM 요청(생성: 빈 타겟·>8명·미존재 유저, 숨기기: DM 아님, 나가기: 1:1·나 혼자 DM — WP-1677). → 400. */
public class InvalidDmRequestException extends RuntimeException {
  public InvalidDmRequestException(String message) {
    super(message);
  }
}
