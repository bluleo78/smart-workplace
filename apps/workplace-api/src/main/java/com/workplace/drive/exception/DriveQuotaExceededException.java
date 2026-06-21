package com.workplace.drive.exception;

/** 드라이브 저장 한도 초과 — 업로드 거부(409). */
public class DriveQuotaExceededException extends RuntimeException {
  public DriveQuotaExceededException(String message) {
    super(message);
  }
}
