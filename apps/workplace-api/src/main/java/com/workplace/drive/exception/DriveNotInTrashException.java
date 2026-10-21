package com.workplace.drive.exception;

/** 휴지통에 없는(또는 trash_root 가 아닌) 항목을 복원/영구삭제하려 할 때. → 404 */
public class DriveNotInTrashException extends RuntimeException {
  public DriveNotInTrashException(String type, long id) {
    // 문구에 id·영문 값을 넣지 않는다 — 응답 message 로 그대로 나가 화면·AI 에 내부 번호가 보였다(WP-672, WP-619 후속)
    super("휴지통에 없는 항목입니다");
  }
}
