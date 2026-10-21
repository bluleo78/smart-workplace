package com.workplace.drive.exception;

/** PERSONAL/CHANNEL 공간에 대한 이름 변경·삭제·멤버 변경 시도 — TEAM 공간만 허용. HTTP 409. */
public class DriveSpaceTypeNotEditableException extends RuntimeException {
  public DriveSpaceTypeNotEditableException(long spaceId, String type) {
    // 문구에 id·영문 값을 넣지 않는다 — 응답 message 로 그대로 나가 화면·AI 에 내부 번호가 보였다(WP-672, WP-619 후속)
    super("팀 공간만 이름·멤버를 바꾸거나 삭제할 수 있습니다");
  }
}
