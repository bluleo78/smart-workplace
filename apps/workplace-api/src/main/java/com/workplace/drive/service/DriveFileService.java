package com.workplace.drive.service;

import com.workplace.drive.dto.DriveFileResponse;
import com.workplace.drive.exception.DriveFileNotFoundException;
import com.workplace.drive.exception.DriveFolderNotFoundException;
import com.workplace.drive.exception.DriveInvalidTargetException;
import com.workplace.drive.repository.DriveFileRepository;
import com.workplace.drive.repository.DriveFolderRepository;
import com.workplace.file.dto.FileUploadResponse;
import com.workplace.file.service.FileUploadService;
import com.workplace.file.service.FileUploadService.FileContentResult;
import java.io.IOException;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;

/** 파일 업로드/다운로드/삭제. 바이트는 file core 재사용. */
@Service
@RequiredArgsConstructor
public class DriveFileService {
  private final DriveFileRepository files;
  private final FileUploadService fileUpload;
  private final DrivePermissions perms;
  private final DriveFolderRepository folders;

  /** 업로드 → file core 저장 → 영구화 → drive_file 바인딩. */
  @Transactional
  public DriveFileResponse upload(long callerId, long spaceId, Long folderId, MultipartFile file)
      throws IOException {
    perms.requireRole(spaceId, callerId, "EDITOR");
    FileUploadResponse uploaded = fileUpload.uploadFiles(List.of(file), callerId).get(0);
    files.promoteFile(uploaded.id());
    long driveFileId = files.insert(spaceId, folderId, uploaded.id(), uploaded.originalName());
    return files.listInFolder(spaceId, folderId).stream()
        .filter(f -> f.id() == driveFileId)
        .findFirst()
        .orElseThrow(() -> new DriveFileNotFoundException(driveFileId));
  }

  /** 다운로드. drive 권한(VIEWER+)으로 인가한 뒤 file core 신뢰 read. */
  @Transactional(readOnly = true)
  public FileContentResult download(long callerId, long driveFileId) throws IOException {
    DriveFileRepository.DriveFileRow row =
        files.findRow(driveFileId).orElseThrow(() -> new DriveFileNotFoundException(driveFileId));
    perms.requireRole(row.spaceId(), callerId, "VIEWER");
    return fileUpload.getFileContentTrusted(row.fileId());
  }

  /** 삭제 — drive_file 제거 + FILE 만료 표시. */
  @Transactional
  public void delete(long callerId, long driveFileId) {
    DriveFileRepository.DriveFileRow row =
        files.findRow(driveFileId).orElseThrow(() -> new DriveFileNotFoundException(driveFileId));
    perms.requireRole(row.spaceId(), callerId, "EDITOR");
    files.delete(driveFileId);
    files.expireFiles(List.of(row.fileId()));
  }

  /** 이동 — 같은 공간 다른 폴더로 folder_id 변경. */
  @Transactional
  public void move(long callerId, long driveFileId, Long targetFolderId) {
    DriveFileRepository.DriveFileRow row =
        files.findRow(driveFileId).orElseThrow(() -> new DriveFileNotFoundException(driveFileId));
    perms.requireRole(row.spaceId(), callerId, "EDITOR");
    validateTargetSameSpace(row.spaceId(), targetFolderId);
    files.updateFolder(driveFileId, targetFolderId);
  }

  /** 복사 — blob 물리 복제(영구) 후 새 drive_file 바인딩. 단일 txn(promote 단계 없음). */
  @Transactional
  public DriveFileResponse copy(long callerId, long driveFileId, Long targetFolderId)
      throws IOException {
    DriveFileRepository.DriveFileRow row =
        files.findRow(driveFileId).orElseThrow(() -> new DriveFileNotFoundException(driveFileId));
    perms.requireRole(row.spaceId(), callerId, "EDITOR");
    validateTargetSameSpace(row.spaceId(), targetFolderId);
    long newFileId = fileUpload.copyFile(row.fileId(), callerId);
    long newDriveFileId = files.insert(row.spaceId(), targetFolderId, newFileId, row.name());
    return files.listInFolder(row.spaceId(), targetFolderId).stream()
        .filter(f -> f.id() == newDriveFileId)
        .findFirst()
        .orElseThrow(() -> new DriveFileNotFoundException(newDriveFileId));
  }

  /** 대상 폴더(있으면)가 같은 공간인지 검증. null = 공간 루트(항상 같은 공간). */
  private void validateTargetSameSpace(long spaceId, Long targetFolderId) {
    if (targetFolderId == null) {
      return;
    }
    long targetSpace =
        folders
            .findSpaceId(targetFolderId)
            .orElseThrow(() -> new DriveFolderNotFoundException(targetFolderId));
    if (targetSpace != spaceId) {
      throw new DriveInvalidTargetException("target folder in different space");
    }
  }
}
