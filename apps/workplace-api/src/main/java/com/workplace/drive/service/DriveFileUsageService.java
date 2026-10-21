package com.workplace.drive.service;

import com.workplace.drive.api.DriveFileUsage;
import com.workplace.drive.repository.DriveFileRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

/** {@link DriveFileUsage} 구현 — 드라이브 파일·버전이 file 행을 가리키는지 확인한다(WP-722). */
@Service
@RequiredArgsConstructor
public class DriveFileUsageService implements DriveFileUsage {
  private final DriveFileRepository files;

  @Override
  public boolean referencesFile(long fileId) {
    return files.anyReferencesFile(fileId);
  }
}
