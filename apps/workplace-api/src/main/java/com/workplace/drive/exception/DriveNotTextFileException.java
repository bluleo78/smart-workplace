package com.workplace.drive.exception;

/**
 * 내용(텍스트)으로 고쳐 쓸 수 없는 파일을 내용으로 갱신하려 할 때(WP-369). → 409. pdf·docx 같은 문서를 텍스트로 덮어 서식을 잃지 않게, 그리고 원본을
 * 글자로 읽을 수 없어 AI 가 원본이 아닌 추출 텍스트를 읽게 되는 파일(원본 없음·10MB 초과·UTF-8 아님, WP-1339)을 덮어 원문을 잃지 않게 막는다.
 */
public class DriveNotTextFileException extends RuntimeException {
  public DriveNotTextFileException() {
    super("텍스트 파일만 내용으로 갱신할 수 있습니다");
  }

  /** 사유를 담은 거절 — 원본을 글자로 읽을 수 없어 내용으로 고쳐 쓸 수 없는 경우(문구는 업로드 링크 안내로 끝난다). */
  public DriveNotTextFileException(String message) {
    super(message);
  }
}
