// DriveReferencedFileRetentionPolicy.java — 드라이브가 쓰는 file 은 만료 스윕이 지우지 않게(WP-1392)
package com.workplace.drive.service;

import com.workplace.drive.repository.DriveFileRepository;
import com.workplace.file.api.ExpiredFileRetentionPolicy;
import java.util.Collection;
import java.util.Set;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

/**
 * 만료 스윕이 지우려는 file 중 drive_file(휴지통 포함)·drive_file_version 이 아직 가리키는 것은 남긴다(WP-1392).
 *
 * <p>왜: 첨부 가져오기는 file 행을 복사하지 않고 drive_file 이 원본 첨부의 file 행을 같이 쓰게 한다(만료 해제). 원래 도메인(이슈 본문 이미지·노트
 * 첨부)은 강등할 때 드라이브 사용 여부를 확인하지만({@link com.workplace.drive.api.DriveFileUsage}), 가져오기와 강등이 거의 동시에
 * 커밋되면 그 확인을 비켜 만료가 다시 걸릴 수 있다. 그대로 두면 스윕이 디스크 원본을 먼저 지운 뒤 DB 삭제가 NO ACTION FK 에 막혀, 드라이브 파일은 남는데
 * 원본은 사라진다. 여기서 한 번 더 걸러 그 틈을 막는다.
 *
 * <p>보존한 file 은 만료를 <b>해제</b>한다 — 다른 정책(만료를 미루기만 함)과 달리, 드라이브가 쓰는 file 은 드라이브 수명주기(영구 삭제 시 만료 표시)가
 * 정리하므로 영구 고아가 되지 않는다. 미루기만 하면 매 사이클 같은 행이 앞자리를 차지해 다른 만료 파일 회수가 밀린다.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class DriveReferencedFileRetentionPolicy implements ExpiredFileRetentionPolicy {

  private final DriveFileRepository files;

  @Override
  public Set<Long> retain(Collection<Long> expiringFileIds) {
    Set<Long> inDrive = files.referencedAmong(expiringFileIds);
    if (!inDrive.isEmpty()) {
      log.warn("만료 대상이지만 드라이브가 쓰고 있는 file 을 보존하고 만료를 해제: {}", inDrive);
      files.promoteFiles(inDrive);
    }
    return inDrive;
  }
}
