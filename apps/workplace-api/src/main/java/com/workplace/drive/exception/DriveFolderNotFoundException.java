package com.workplace.drive.exception;

/** 드라이브 폴더 미존재 또는 접근 불가. → 404. */
public class DriveFolderNotFoundException extends RuntimeException {
  public DriveFolderNotFoundException(long folderId) {
    // 문구에 id 를 넣지 않는다 — 응답 message 로 그대로 나가 화면·AI 에 내부 번호가 보였다(WP-619)
    super("드라이브 폴더를 찾을 수 없습니다");
  }
}
