package com.workplace.drive.service;

import com.workplace.audit.service.AuditLogService;
import com.workplace.drive.dto.DriveFileResponse;
import com.workplace.drive.dto.FileSummaryResponse;
import com.workplace.drive.exception.DriveDuplicateNameException;
import com.workplace.drive.exception.DriveFileNotFoundException;
import com.workplace.drive.exception.DriveFolderNotFoundException;
import com.workplace.drive.exception.DriveInvalidTargetException;
import com.workplace.drive.outbound.DriveFileUploadedEvent;
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
import org.springframework.context.ApplicationEventPublisher;
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

  /** 파일 버전 레포지토리 — 동명 업로드 자동 버전화(#79). */
  private final com.workplace.drive.repository.DriveFileVersionRepository versions;

  /** 파일 콘텐츠 요약 읽기(#526) — file_extraction.summary 조회. */
  private final com.workplace.drive.repository.DriveFileSummaryRepository summaries;

  /**
   * 업로드 → 쿼터 검사(advisory lock) → file core 저장 → 영구화 → drive_file 바인딩. 동명 활성 파일이 있으면 새 버전으로 흡수(#79),
   * 없으면 새 파일 + v1.
   */
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

    String name = uploaded.originalName();
    long driveFileId;
    String actionType;
    int versionNo;
    // 동명 활성 파일이 있으면 새 버전으로 흡수, 없으면 새 파일 + v1 (#79)
    var existing = files.findActiveByName(spaceId, folderId, name);
    if (existing.isPresent()) {
      driveFileId = existing.get();
      versionNo = versions.nextVersionNo(driveFileId);
      versions.insert(driveFileId, versionNo, uploaded.id(), file.getSize(), callerId, null);
      files.setCurrentVersion(driveFileId, uploaded.id(), versionNo);
      actionType = "FILE_VERSION_CREATED";
    } else {
      // insertWithInitialVersion 이 drive_file + v1 버전 행을 원자적으로 생성(#79 불변식 강제)
      driveFileId =
          files.insertWithInitialVersion(
              spaceId, folderId, uploaded.id(), name, file.getSize(), callerId);
      versionNo = 1;
      actionType = "FILE_UPLOAD";
    }

    // 감사 로그 — 같은 @Transactional 안에서 기록(#81).
    auditLogService.log(
        callerId,
        usernameOf(callerId),
        actionType,
        "drive",
        String.valueOf(driveFileId),
        ("FILE_VERSION_CREATED".equals(actionType) ? "드라이브 파일 새 버전: " : "드라이브 파일 업로드: ")
            + name
            + " (v"
            + versionNo
            + ")",
        null,
        null,
        "SUCCESS",
        null,
        Map.of(
            "spaceId", spaceId,
            "fileName", name,
            "sizeBytes", file.getSize(),
            "versionNo", versionNo));

    // 추출 파이프라인 트리거 — 커밋 후 FileExtractionListener 가 file_extraction 행을 생성(PENDING/SKIPPED).
    // storageKey 는 file 테이블의 storage_path(워커가 blob 위치 특정에 사용).
    String storageKey =
        dsl.select(com.workplace.jooq.Tables.FILE.STORAGE_PATH)
            .from(com.workplace.jooq.Tables.FILE)
            .where(com.workplace.jooq.Tables.FILE.ID.eq(uploaded.id()))
            .fetchOne(com.workplace.jooq.Tables.FILE.STORAGE_PATH);
    eventPublisher.publishEvent(
        new DriveFileUploadedEvent(
            uploaded.id(),
            tenantId != null ? tenantId : 0L,
            uploaded.mimeType(),
            uploaded.fileCategory(),
            file.getSize(),
            storageKey != null ? storageKey : ""));

    final long fid = driveFileId;
    return files.listInFolder(spaceId, folderId).stream()
        .filter(f -> f.id() == fid)
        .findFirst()
        .orElseThrow(() -> new DriveFileNotFoundException(fid));
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
   * 파일 콘텐츠 요약 조회(#526). drive 권한(VIEWER+)으로 인가 후 file_extraction 신뢰 read. 접근 게이트는 download 와
   * 동일(스페이스 멤버십). 트랜잭션 안에서 호출되어 테넌트 GUC 가 주입된다.
   */
  @Transactional(readOnly = true)
  public FileSummaryResponse fileSummary(long callerId, long driveFileId) {
    DriveFileRepository.DriveFileRow row =
        files.findRow(driveFileId).orElseThrow(() -> new DriveFileNotFoundException(driveFileId));
    perms.requireRole(row.spaceId(), callerId, "VIEWER");
    var r = summaries.findSummary(row.fileId());
    return new FileSummaryResponse(r.summary(), r.status(), toReason(r.status(), r.error()));
  }

  /** file_extraction.error → 사용자 문구 매핑. 내부 예외 메시지·경로 노출 방지(#735). */
  private static String toReason(String status, String error) {
    if (!"SKIPPED".equals(status) && !"FAILED".equals(status)) return null;
    if (error == null) return "요약에 실패했습니다.";
    if (error.startsWith("image:")) return "이미지 파일은 요약하지 않습니다.";
    if (error.startsWith("unsupported-mime:")) return "이 형식은 텍스트 추출을 지원하지 않습니다.";
    if ("FAILED".equals(status)) return "요약에 실패했습니다.";
    return "파일에서 텍스트를 찾지 못해 요약할 수 없습니다.";
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

  /** 추출 파이프라인 이벤트 발행용 — 업로드 커밋 후 FileExtractionListener 가 file_extraction 행 생성. */
  private final ApplicationEventPublisher eventPublisher;

  /** 버전 이력 목록(VIEWER). 최신(version_no 최대) 행을 current 로 표시. */
  @Transactional(readOnly = true)
  public java.util.List<com.workplace.drive.dto.DriveFileVersionResponse> listVersions(
      long callerId, long driveFileId) {
    DriveFileRepository.DriveFileRow row =
        files.findRow(driveFileId).orElseThrow(() -> new DriveFileNotFoundException(driveFileId));
    perms.requireRole(row.spaceId(), callerId, "VIEWER");
    var rows = versions.listForDriveFile(driveFileId); // version_no DESC
    java.util.List<com.workplace.drive.dto.DriveFileVersionResponse> out =
        new java.util.ArrayList<>();
    for (int i = 0; i < rows.size(); i++) {
      var v = rows.get(i);
      out.add(
          new com.workplace.drive.dto.DriveFileVersionResponse(
              v.versionNo(),
              v.fileId(),
              v.sizeBytes(),
              v.uploadedBy(),
              v.uploadedByName(),
              v.createdAt(),
              v.comment(),
              i == 0)); // DESC 정렬의 첫 행이 최신=현재
    }
    return out;
  }

  /** 특정 버전 blob 다운로드(VIEWER). */
  @Transactional(readOnly = true)
  public FileContentResult downloadVersion(long callerId, long driveFileId, int versionNo)
      throws IOException {
    DriveFileRepository.DriveFileRow row =
        files.findRow(driveFileId).orElseThrow(() -> new DriveFileNotFoundException(driveFileId));
    perms.requireRole(row.spaceId(), callerId, "VIEWER");
    var v =
        versions
            .findVersion(driveFileId, versionNo)
            .orElseThrow(() -> new DriveFileNotFoundException(driveFileId));
    return fileUpload.getFileContentTrusted(v.fileId());
  }

  /** 롤백(#79) — 대상 버전 blob 을 물리 클론해 새 버전으로 append(비파괴). EDITOR. */
  @Transactional
  public DriveFileResponse rollback(long callerId, long driveFileId, int targetVersionNo)
      throws IOException {
    DriveFileRepository.DriveFileRow row =
        files.findRow(driveFileId).orElseThrow(() -> new DriveFileNotFoundException(driveFileId));
    perms.requireRole(row.spaceId(), callerId, "EDITOR");
    var target =
        versions
            .findVersion(driveFileId, targetVersionNo)
            .orElseThrow(() -> new DriveFileNotFoundException(driveFileId));
    // 새 blob 이 생기므로 쿼터 검사(테넌트 직렬화 잠금).
    Long tenantId = TenantContext.get();
    if (tenantId != null) {
      quotaRepo.advisoryLockTenant(tenantId);
    }
    quota.assertWithinQuota(target.sizeBytes());
    long newFileId = fileUpload.copyFile(target.fileId(), callerId);
    int newVersionNo = versions.nextVersionNo(driveFileId);
    versions.insert(
        driveFileId,
        newVersionNo,
        newFileId,
        target.sizeBytes(),
        callerId,
        "v" + targetVersionNo + "에서 복원");
    files.setCurrentVersion(driveFileId, newFileId, newVersionNo);

    auditLogService.log(
        callerId,
        usernameOf(callerId),
        "FILE_ROLLBACK",
        "drive",
        String.valueOf(driveFileId),
        "드라이브 파일 롤백: " + row.name() + " (v" + targetVersionNo + " → v" + newVersionNo + ")",
        null,
        null,
        "SUCCESS",
        null,
        Map.of(
            "fromVersionNo", targetVersionNo,
            "toVersionNo", newVersionNo,
            "fileName", row.name()));

    return files
        .findResponse(driveFileId)
        .orElseThrow(() -> new DriveFileNotFoundException(driveFileId));
  }

  /** 이동 — 같은 공간 다른 폴더로 folder_id 변경. 같은 폴더면 no-op. 동명 충돌 시 409. */
  @Transactional
  public void move(long callerId, long driveFileId, Long targetFolderId) {
    DriveFileRepository.DriveFileRow row =
        files.findRow(driveFileId).orElseThrow(() -> new DriveFileNotFoundException(driveFileId));
    perms.requireRole(row.spaceId(), callerId, "EDITOR");
    validateTargetSameSpace(row.spaceId(), targetFolderId);
    // 같은 폴더로의 이동은 no-op — 자기 자신과의 이름 충돌로 인한 잘못된 409 방지
    if (java.util.Objects.equals(row.folderId(), targetFolderId)) {
      return;
    }
    // 대상 폴더에 동명 활성 파일이 있으면 충돌(#79 부분 유니크 인덱스 대응)
    if (files.findActiveByName(row.spaceId(), targetFolderId, row.name()).isPresent()) {
      throw new DriveDuplicateNameException(row.name());
    }
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
    // 대상 폴더에 동명 활성 파일이 있으면 충돌(#79 부분 유니크 인덱스 대응)
    if (files.findActiveByName(row.spaceId(), targetFolderId, row.name()).isPresent()) {
      throw new DriveDuplicateNameException(row.name());
    }
    long newFileId = fileUpload.copyFile(row.fileId(), callerId);
    // insertWithInitialVersion 으로 복사본도 v1 버전 행을 즉시 생성(#79 불변식 — copy 도 quota 집계·purge 대상)
    long newDriveFileId =
        files.insertWithInitialVersion(
            row.spaceId(),
            targetFolderId,
            newFileId,
            row.name(),
            copiedSizeBytes == null ? 0L : copiedSizeBytes,
            callerId);
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
      throw new DriveInvalidTargetException("다른 공간으로는 이동/복사할 수 없습니다.");
    }
  }
}
