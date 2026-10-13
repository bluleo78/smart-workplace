package com.workplace.drive.exception;

/** 텍스트 계열이 아닌 파일을 내용(텍스트)으로 갱신하려 할 때(WP-369). → 409. pdf·docx 같은 문서를 텍스트로 덮어 서식을 잃지 않게 막는다. */
public class DriveNotTextFileException extends RuntimeException {
  public DriveNotTextFileException() {
    super("텍스트 파일만 내용으로 갱신할 수 있습니다");
  }
}
