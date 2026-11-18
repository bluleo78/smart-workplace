package com.workplace.drive.service;

import com.workplace.file.api.StagedCopySource;
import com.workplace.file.api.StagedCopySourceResolver;
import org.springframework.stereotype.Component;

/**
 * 스테이징 복사의 {@code drive} 출처(WP-1705) — 드라이브 파일의 현재 버전을 호출자 소유 임시 파일로 복사할 수 있게 원본 FILE id 를 판정한다.
 *
 * <p>읽기 가드는 새로 만들지 않고 {@link DriveFileService#resolveViewFileId} 를 그대로 쓴다 — 다운로드·미리보기와 같은 가드(없는·휴지통
 * 파일 404, 공간 VIEWER 이상)라 권한 규칙이 어긋나지 않고, 비멤버는 없는 파일과 같은 404 로 숨겨진다.
 */
@Component
public class DriveStagedCopySource implements StagedCopySourceResolver {

  /** 출처 키 — 요청의 {@code source} 값. */
  static final String SOURCE = "drive";

  private final DriveFileService driveFileService;

  public DriveStagedCopySource(DriveFileService driveFileService) {
    this.driveFileService = driveFileService;
  }

  @Override
  public String source() {
    return SOURCE;
  }

  /** driveFileId 를 확인하고 드라이브 읽기 가드를 거쳐 현재 버전의 원본 FILE id 를 돌려준다. */
  @Override
  public long resolveReadableFileId(long callerId, StagedCopySource src) {
    if (src.driveFileId() == null) {
      throw new IllegalArgumentException("source 'drive' 는 driveFileId 가 필요합니다");
    }
    return driveFileService.resolveViewFileId(callerId, src.driveFileId());
  }
}
