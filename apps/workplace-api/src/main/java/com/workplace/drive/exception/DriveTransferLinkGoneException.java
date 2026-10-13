package com.workplace.drive.exception;

/** 전송 링크(WP-369)가 만료되었거나 이미 사용됨(일회용). → 410 Gone */
public class DriveTransferLinkGoneException extends RuntimeException {
  public DriveTransferLinkGoneException() {
    super("전송 링크가 만료되었거나 이미 사용되었습니다. 새 링크를 발급받으세요");
  }
}
