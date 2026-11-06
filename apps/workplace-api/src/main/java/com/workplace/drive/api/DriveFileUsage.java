package com.workplace.drive.api;

import java.util.Collection;
import java.util.List;
import java.util.Set;

/**
 * 드라이브가 file 행을 쓰고 있는지 알려 주는 공개 포트(WP-722). 이슈 첨부를 드라이브로 가져가면 drive_file 이 같은 file 행을 가리키므로, 이슈 쪽에서
 * 첨부를 지울 때 file 행·원본까지 지워도 되는지 여기서 확인한다.
 */
public interface DriveFileUsage {

  /** fileId 를 가리키는 drive_file(휴지통 포함 — 영구 삭제 전까지 남는다) 또는 drive_file_version 이 있으면 true. */
  boolean referencesFile(long fileId);

  /**
   * fileIds 중 drive_file(휴지통 포함) 또는 drive_file_version 이 가리키는 것만 돌려준다(WP-1392). 이슈 본문 이미지·노트 첨부도
   * 드라이브로 가져갈 수 있게 되어, 그쪽이 강등(만료 재무장)·회수할 때 여러 파일을 한 번에 걸러 내는 용도다.
   */
  Set<Long> referencedAmong(Collection<Long> fileIds);

  /**
   * fileIds 중 드라이브가 쓰지 <b>않는</b> 것만 입력 순서대로 돌려준다(WP-1392) — 이슈 본문 이미지·노트 첨부의 만료 스윕 보존 정책이 드라이브로 가져간
   * file 을 판정·재무장하지 않게 거르는 공용 판. 그 file 의 수명은 드라이브가 맡는다(WP-722 와 같은 규칙).
   */
  default List<Long> withoutReferenced(Collection<Long> fileIds) {
    Set<Long> referenced = referencedAmong(fileIds);
    return fileIds.stream().filter(id -> !referenced.contains(id)).toList();
  }
}
