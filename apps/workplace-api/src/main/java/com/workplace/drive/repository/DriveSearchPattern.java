package com.workplace.drive.repository;

/** 이름 검색용 LIKE 패턴 이스케이프 — 사용자 입력의 %, _, \ 를 리터럴로 처리한다(escape char '\'). */
final class DriveSearchPattern {
  private DriveSearchPattern() {}

  static String escape(String q) {
    return q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_");
  }
}
