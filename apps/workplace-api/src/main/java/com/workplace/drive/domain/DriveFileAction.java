package com.workplace.drive.domain;

/**
 * 드라이브 「최근」(WP-1699) 에 남기는 행동 종류. 값은 drive_file_activity.last_action(CHECK) 와 같은 문자열이다.
 *
 * <ul>
 *   <li>OPEN — 파일을 열었음(보기·내용 받기)
 *   <li>UPLOAD — 파일을 새로 올렸음
 *   <li>NEW_VERSION — 기존 파일에 새 판을 올렸음
 * </ul>
 */
public enum DriveFileAction {
  OPEN,
  UPLOAD,
  NEW_VERSION
}
