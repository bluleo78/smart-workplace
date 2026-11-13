package com.workplace.drive.exception;

/** 나눠 올리기 세션(WP-1520)이 없음·만료됨·남의 것 → 404. 세 경우를 가르지 않는다 — 남의 세션 id 가 있는지조차 드러내지 않으려는 것이다(존재 은닉). */
public class DriveUploadSessionNotFoundException extends RuntimeException {
  public DriveUploadSessionNotFoundException() {
    super("업로드 세션을 찾을 수 없습니다. 처음부터 다시 올려 주세요");
  }
}
