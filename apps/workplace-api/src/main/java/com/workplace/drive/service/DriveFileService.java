package com.workplace.drive.service;

import com.workplace.audit.service.AuditLogService;
import com.workplace.drive.dto.DriveFileResponse;
import com.workplace.drive.exception.DriveFileNotFoundException;
import com.workplace.drive.exception.DriveFolderNotFoundException;
import com.workplace.drive.exception.DriveInvalidTargetException;
import com.workplace.drive.repository.DriveFileRepository;
import com.workplace.drive.repository.DriveFolderRepository;
import com.workplace.drive.repository.DriveQuotaRepository;
import com.workplace.file.dto.FileUploadResponse;
import com.workplace.file.service.FileUploadService;
import com.workplace.file.service.FileUploadService.FileContentResult;
import com.workplace.global.tenant.TenantContext;
import com.workplace.user.repository.UserRepository;
import java.io.IOException;
import java.util.List;
import java.util.Map;
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
  private final org.jooq.DSLContext dsl;

  /** 업로드 시 쿼터 강제 — 테넌트 단위 직렬화 잠금 + 사용량 검사(#81). */
  private final DriveQuotaService quota;

  private final DriveQuotaRepository quotaRepo;

  /** 감사 로그 기록(#81). */
  private final AuditLogService auditLogService;

  /** 사용자명 조회용 — 감사 로그에 username 을 기록한다(#81). */
  private final UserRepository userRepository;

  /** 업로드 → 쿼터 검사(advisory lock) → file core 저장 → 영구화 → drive_file 바인딩. */
  @Transactional
  public DriveFileResponse upload(long callerId, long spaceId, Long folderId, MultipartFile file)
      throws IOException {
    perms.requireRole(spaceId, callerId, "EDITOR");
    // 쿼터 강제: 테넌트 단위 직렬화 잠금 후 사용량 검사(동시 업로드 레이스 방지, #81).
    Long tenantId = TenantContext.get();
    if (tenantId != null) {
      quotaRepo.advisoryLockTenant(tenantId);
    }
    quota.assertWithinQuota(file.getSize());
    FileUploadResponse uploaded = fileUpload.uploadFiles(List.of(file), callerId).get(0);
    files.promoteFile(uploaded.id());
    long driveFileId = files.insert(spaceId, folderId, uploaded.id(), uploaded.originalName());
    // 감사 로그 — FILE_UPLOAD(#81), 같은 @Transactional 안에서 기록.
    auditLogService.log(
        callerId,
        usernameOf(callerId),
        "FILE_UPLOAD",
        "drive",
        String.valueOf(driveFileId),
        "드라이브 파일 업로드: " + uploaded.originalName(),
        null,
        null,
        "SUCCESS",
        null,
        Map.of(
            "spaceId", spaceId, "fileName", uploaded.originalName(), "sizeBytes", file.getSize()));
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

  /**
   * 공유 링크 다운로드. 멤버십 검사 없이(capability URL) 컨텍스트 설정 후 file core 신뢰 read. trashed 파일은 findRow 가 제외 →
   * 호출부에서 NotFound 처리.
   */
  @Transactional(readOnly = true)
  public FileContentResult downloadViaShareLink(long driveFileId) throws IOException {
    DriveFileRepository.DriveFileRow row =
        files.findRow(driveFileId).orElseThrow(() -> new DriveFileNotFoundException(driveFileId));
    return fileUpload.getFileContentTrusted(row.fileId());
  }

  /** 썸네일. drive 권한(VIEWER+)으로 인가한 뒤 file core 신뢰 read. 없으면 빈 Optional → 컨트롤러 404. */
  @Transactional(readOnly = true)
  public java.util.Optional<FileContentResult> thumbnail(long callerId, long driveFileId)
      throws IOException {
    DriveFileRepository.DriveFileRow row =
        files.findRow(driveFileId).orElseThrow(() -> new DriveFileNotFoundException(driveFileId));
    perms.requireRole(row.spaceId(), callerId, "VIEWER");
    return fileUpload.getThumbnailContentTrusted(row.fileId());
  }

  /** 삭제 = 휴지통으로(soft). drive_file 행 보존·trashed 표시. blob 은 영구삭제 시점까지 보존. */
  @Transactional
  public void delete(long callerId, long driveFileId) {
    DriveFileRepository.DriveFileRow row =
        files.findRow(driveFileId).orElseThrow(() -> new DriveFileNotFoundException(driveFileId));
    perms.requireRole(row.spaceId(), callerId, "EDITOR");
    long opId = dsl.nextval(com.workplace.jooq.Sequences.DRIVE_TRASH_OP_SEQ);
    files.markTrashed(driveFileId, opId);
    // 감사 로그 — FILE_DELETE(#81), 같은 @Transactional 안에서 기록.
    auditLogService.log(
        callerId,
        usernameOf(callerId),
        "FILE_DELETE",
        "drive",
        String.valueOf(driveFileId),
        "드라이브 파일 삭제: " + row.name(),
        null,
        null,
        "SUCCESS",
        null,
        Map.of("spaceId", row.spaceId(), "fileName", row.name()));
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
    // 쿼터 강제: 복사도 새 바이트를 소비하므로 upload 와 동일하게 advisory lock + 검사(#81).
    Long tenantId = TenantContext.get();
    if (tenantId != null) {
      quotaRepo.advisoryLockTenant(tenantId);
    }
    // 복사 원본의 파일 크기를 FILE 테이블에서 직접 조회한다.
    Long copiedSizeBytes =
        dsl.select(com.workplace.jooq.Tables.FILE.SIZE_BYTES)
            .from(com.workplace.jooq.Tables.FILE)
            .where(com.workplace.jooq.Tables.FILE.ID.eq(row.fileId()))
            .fetchOne(com.workplace.jooq.Tables.FILE.SIZE_BYTES);
    quota.assertWithinQuota(copiedSizeBytes == null ? 0L : copiedSizeBytes);
    long newFileId = fileUpload.copyFile(row.fileId(), callerId);
    long newDriveFileId = files.insert(row.spaceId(), targetFolderId, newFileId, row.name());
    return files.listInFolder(row.spaceId(), targetFolderId).stream()
        .filter(f -> f.id() == newDriveFileId)
        .findFirst()
        .orElseThrow(() -> new DriveFileNotFoundException(newDriveFileId));
  }

  /**
   * 감사 로그용 사용자명 조회. 없으면 userId 문자열로 대체(#81).
   *
   * <p>AuthService 와 동일하게 UserRepository.findById 를 통해 username 을 얻는다.
   */
  private String usernameOf(long userId) {
    return userRepository
        .findById(userId)
        .map(com.workplace.user.dto.UserResponse::username)
        .orElse(String.valueOf(userId));
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
