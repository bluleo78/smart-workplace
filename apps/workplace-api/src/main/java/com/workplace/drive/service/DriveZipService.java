package com.workplace.drive.service;

import com.workplace.drive.dto.DriveFileResponse;
import com.workplace.drive.dto.DriveFolderResponse;
import com.workplace.drive.exception.DriveFileNotFoundException;
import com.workplace.drive.exception.DriveFolderNotFoundException;
import com.workplace.drive.exception.DriveInvalidTargetException;
import com.workplace.drive.repository.DriveFileRepository;
import com.workplace.drive.repository.DriveFolderRepository;
import com.workplace.file.service.FileUploadService;
import com.workplace.file.service.FileUploadService.FileContentResult;
import java.io.IOException;
import java.util.ArrayList;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * ZIP 다운로드용 엔트리 수집 + 단건 콘텐츠 오픈. collectEntries 는 경로·coreFileId 메타데이터만 모으고(트랜잭션 안), 실제 바이트는 컨트롤러가
 * 스트리밍 스레드에서 엔트리마다 openContent 로 한 파일씩 lazy 하게 연다(fd 1개 제한).
 */
@Service
@RequiredArgsConstructor
public class DriveZipService {
  private final DriveFileRepository files;
  private final DriveFolderRepository folders;
  private final DrivePermissions perms;
  private final FileUploadService fileUpload;

  /** ZIP 엔트리 메타데이터. directory=true 면 빈 디렉터리 엔트리(coreFileId=null). */
  public record ZipEntrySource(String path, Long coreFileId, boolean directory) {}

  /** 선택 항목을 ZIP 엔트리 메타 목록으로 수집. VIEWER+ 1회 검사(단일 space). */
  @Transactional(readOnly = true)
  public List<ZipEntrySource> collectEntries(
      long callerId, long spaceId, List<Long> fileIds, List<Long> folderIds) {
    perms.requireRole(spaceId, callerId, "VIEWER");
    List<ZipEntrySource> entries = new ArrayList<>();

    if (fileIds != null) {
      for (Long fileId : fileIds) {
        DriveFileRepository.DriveFileRow row =
            files.findRow(fileId).orElseThrow(() -> new DriveFileNotFoundException(fileId));
        if (row.spaceId() != spaceId) {
          throw new DriveInvalidTargetException("다른 공간의 파일은 포함할 수 없습니다.");
        }
        entries.add(new ZipEntrySource(row.name(), row.fileId(), false));
      }
    }
    if (folderIds != null) {
      for (Long folderId : folderIds) {
        long fSpace =
            folders
                .findSpaceId(folderId)
                .orElseThrow(() -> new DriveFolderNotFoundException(folderId));
        if (fSpace != spaceId) {
          throw new DriveInvalidTargetException("다른 공간의 폴더는 포함할 수 없습니다.");
        }
        DriveFolderResponse f =
            folders
                .findById(folderId)
                .orElseThrow(() -> new DriveFolderNotFoundException(folderId));
        collectFolder(spaceId, folderId, f.name(), entries);
      }
    }
    return entries;
  }

  /** 한 폴더의 파일·하위폴더를 재귀로 prefix 경로 아래 수집. 비어 있으면 디렉터리 엔트리 1개 추가. */
  private void collectFolder(long spaceId, long folderId, String prefix, List<ZipEntrySource> out) {
    List<DriveFileResponse> childFiles = files.listInFolder(spaceId, folderId);
    List<DriveFolderResponse> childFolders = folders.listChildFolders(spaceId, folderId);
    if (childFiles.isEmpty() && childFolders.isEmpty()) {
      out.add(new ZipEntrySource(prefix + "/", null, true));
      return;
    }
    for (DriveFileResponse cf : childFiles) {
      out.add(new ZipEntrySource(prefix + "/" + cf.name(), cf.fileId(), false));
    }
    for (DriveFolderResponse cd : childFolders) {
      collectFolder(spaceId, cd.id(), prefix + "/" + cd.name(), out);
    }
  }

  /** 스트리밍 시점에 한 파일 콘텐츠를 연다. 호출 스레드에 TenantContext 가 설정되어 있어야 RLS 가 통과한다. */
  @Transactional(readOnly = true)
  public FileContentResult openContent(long coreFileId) throws IOException {
    return fileUpload.getFileContentTrusted(coreFileId);
  }
}
