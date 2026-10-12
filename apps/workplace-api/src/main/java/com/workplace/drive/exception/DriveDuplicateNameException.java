package com.workplace.drive.exception;

/** 같은 폴더 안 이름 중복(파일·폴더 생성·이동·이름변경). → 409. 문구는 화면에 그대로 보이므로 사용자 문구로 쓴다(WP-335). */
public class DriveDuplicateNameException extends RuntimeException {
  public DriveDuplicateNameException(String name) {
    super("같은 폴더에 이미 '" + name + "' 이름이 있습니다.");
  }
}
