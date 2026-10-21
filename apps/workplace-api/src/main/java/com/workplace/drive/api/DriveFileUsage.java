package com.workplace.drive.api;

/**
 * 드라이브가 file 행을 쓰고 있는지 알려 주는 공개 포트(WP-722). 이슈 첨부를 드라이브로 가져가면 drive_file 이 같은 file 행을 가리키므로, 이슈 쪽에서
 * 첨부를 지울 때 file 행·원본까지 지워도 되는지 여기서 확인한다.
 */
public interface DriveFileUsage {

  /** fileId 를 가리키는 drive_file(휴지통 포함 — 영구 삭제 전까지 남는다) 또는 drive_file_version 이 있으면 true. */
  boolean referencesFile(long fileId);
}
