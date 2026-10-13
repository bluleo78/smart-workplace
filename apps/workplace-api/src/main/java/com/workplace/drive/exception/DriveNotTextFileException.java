package com.workplace.drive.exception;

/**
 * 내용(텍스트)으로 고쳐 쓸 수 없는 파일을 내용으로 갱신하려 할 때(WP-369). → 409. pdf·docx 같은 문서를 텍스트로 덮어 서식을 잃지 않게, 그리고 추출
 * 텍스트가 원문과 다른 파일(html·UTF-8 아님·추출 잘림)을 AI 가 읽은 텍스트로 덮어 원문을 잃지 않게 막는다.
 */
public class DriveNotTextFileException extends RuntimeException {
  public DriveNotTextFileException() {
    super("텍스트 파일만 내용으로 갱신할 수 있습니다");
  }

  /** 사유를 담은 거절 — 추출 텍스트가 원문과 달라 내용으로 고쳐 쓸 수 없는 경우(문구는 업로드 링크 안내로 끝난다). */
  public DriveNotTextFileException(String message) {
    super(message);
  }
}
