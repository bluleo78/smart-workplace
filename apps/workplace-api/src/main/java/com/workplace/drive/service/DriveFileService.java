package com.workplace.drive.service;

import com.workplace.drive.dto.DriveFileResponse;
import com.workplace.drive.exception.DriveFileNotFoundException;
import com.workplace.drive.repository.DriveFileRepository;
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
}
