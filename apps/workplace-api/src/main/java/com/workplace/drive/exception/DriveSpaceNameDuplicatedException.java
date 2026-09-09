package com.workplace.drive.exception;

/** 같은 테넌트 내 TEAM 드라이브 공간 이름 중복 — 409 매핑(#696, 컨테이너류 이름 하드 차단 정책). */
public class DriveSpaceNameDuplicatedException extends RuntimeException {
  public DriveSpaceNameDuplicatedException(String name) {
    super("이미 존재하는 공간 이름입니다: " + name);
  }
}
