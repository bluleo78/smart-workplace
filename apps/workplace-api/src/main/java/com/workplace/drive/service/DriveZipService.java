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
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * ZIP 다운로드용 엔트리 수집 + 단건 콘텐츠 오픈. collectEntries 는 경로·coreFileId 메타데이터만 모으고(트랜잭션 안), 실제 바이트는 컨트롤러가
 * 스트리밍 스레드에서 엔트리마다 openContent 로 한 파일씩 lazy 하게 연다(fd 1개 제한).
 *
 * <p>엔트리 경로는 이름 조각마다 {@link DriveNames#zipSegment} 로 정리하고 ZIP 폴더 단위로 {@link DriveNames#uniqueIn} 으로
 * 겹치지 않게 만든다(WP-339) — 경로 문자가 든 옛 이름이 압축 밖으로 나가거나, 같은 이름의 파일·폴더가 항목을 빠뜨리거나 ZIP 을 깨뜨리지 않게.
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
    // ZIP 최상위에서 이미 쓴 이름 — 고른 파일과 고른 폴더가 같은 이름 공간을 나눠 쓴다.
    Set<String> rootTaken = new HashSet<>();

    if (fileIds != null) {
      for (Long fileId : fileIds) {
        DriveFileRepository.DriveFileRow row =
            files.findRow(fileId).orElseThrow(() -> new DriveFileNotFoundException(fileId));
        if (row.spaceId() != spaceId) {
          throw new DriveInvalidTargetException("다른 공간의 파일은 포함할 수 없습니다.");
        }
        String path = DriveNames.uniqueIn(rootTaken, DriveNames.zipSegment(row.name()), true);
        entries.add(new ZipEntrySource(path, row.fileId(), false));
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
        String prefix = DriveNames.uniqueIn(rootTaken, DriveNames.zipSegment(f.name()), false);
        collectFolder(spaceId, folderId, prefix, entries);
      }
    }
    return entries;
  }

  /**
   * 한 폴더의 파일·하위폴더를 재귀로 prefix 경로 아래 수집. 비어 있으면 디렉터리 엔트리 1개 추가. prefix 는 이미 정리·중복 회피된 경로이고, 이 폴더 안의
   * 파일·하위폴더 이름은 한 이름 공간에서 겹치지 않게 만든다.
   */
  private void collectFolder(long spaceId, long folderId, String prefix, List<ZipEntrySource> out) {
    List<DriveFileResponse> childFiles = files.listInFolder(spaceId, folderId);
    List<DriveFolderResponse> childFolders = folders.listChildFolders(spaceId, folderId);
    if (childFiles.isEmpty() && childFolders.isEmpty()) {
      out.add(new ZipEntrySource(prefix + "/", null, true));
      return;
    }
    Set<String> taken = new HashSet<>();
    for (DriveFileResponse cf : childFiles) {
      String name = DriveNames.uniqueIn(taken, DriveNames.zipSegment(cf.name()), true);
      out.add(new ZipEntrySource(prefix + "/" + name, cf.fileId(), false));
    }
    for (DriveFolderResponse cd : childFolders) {
      String name = DriveNames.uniqueIn(taken, DriveNames.zipSegment(cd.name()), false);
      collectFolder(spaceId, cd.id(), prefix + "/" + name, out);
    }
  }

  /** 스트리밍 시점에 한 파일 콘텐츠를 연다. 호출 스레드에 TenantContext 가 설정되어 있어야 RLS 가 통과한다. */
  @Transactional(readOnly = true)
  public FileContentResult openContent(long coreFileId) throws IOException {
    return fileUpload.getFileContentTrusted(coreFileId);
  }
}
