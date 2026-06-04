package com.workplace.drive.exception;

/** 휴지통에 없는(또는 trash_root 가 아닌) 항목을 복원/영구삭제하려 할 때. → 404 */
public class DriveNotInTrashException extends RuntimeException {
  public DriveNotInTrashException(String type, long id) {
    super(type + " " + id + " not in trash");
  }
}
