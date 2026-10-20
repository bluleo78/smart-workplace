package com.workplace.file.exception;

/** 파일 행 미존재(존재하지 않거나 접근 불가). → 404. */
public class FileNotFoundException extends RuntimeException {
  public FileNotFoundException(Long fileId) {
    // 문구에 id 를 넣지 않는다 — 응답 message 로 그대로 나가 화면·AI 에 내부 번호가 보였다(WP-619)
    super("파일을 찾을 수 없습니다");
  }
}
