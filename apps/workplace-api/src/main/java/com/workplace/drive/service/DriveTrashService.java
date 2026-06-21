package com.workplace.drive.service;

import com.workplace.drive.dto.DriveFolderResponse;
import com.workplace.drive.dto.DriveTrashItemResponse;
import com.workplace.drive.dto.DriveTrashListResponse;
import com.workplace.drive.repository.DriveFileRepository;
import com.workplace.drive.repository.DriveFileVersionRepository;
import com.workplace.drive.repository.DriveFolderRepository;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** 휴지통 조회·복원·영구삭제·비우기. trash_op_id 단위로 복원하고, 영구삭제 시 file core 에 blob 정리를 위임한다. */
@Service
@RequiredArgsConstructor
public class DriveTrashService {
  private final DriveFolderRepository folders;
  private final DriveFileRepository files;
  private final DriveFileVersionRepository versions; // 전 버전 blob file_id 조회 (#79)
  private final DrivePermissions perms;

  /** 휴지통 보존기간(일). 경과 시 자동 영구삭제. */
  @Value("${drive.trash.retention-days:30}")
  private int retentionDays;

  /** 공간 휴지통 목록 — trash_root 폴더+파일, 원래 경로·자동삭제예정일 포함. VIEWER 이상. */
  @Transactional(readOnly = true)
  public DriveTrashListResponse listTrash(long callerId, long spaceId) {
    perms.requireRole(spaceId, callerId, "VIEWER");
    Map<Long, DriveFolderResponse> byId = new HashMap<>();
    for (DriveFolderResponse f : folders.listAllFolders(spaceId)) byId.put(f.id(), f);

    List<DriveTrashItemResponse> items = new ArrayList<>();
    for (var r : folders.listTrashedFolders(spaceId)) {
      items.add(
          new DriveTrashItemResponse(
              "FOLDER",
              r.id(),
              r.name(),
              pathOf(r.parentId(), byId),
              r.trashedAt(),
              r.trashedAt().plusDays(retentionDays),
              null));
    }
    for (var r : files.listTrashedFiles(spaceId)) {
      items.add(
          new DriveTrashItemResponse(
              "FILE",
              r.id(),
              r.name(),
              pathOf(r.folderId(), byId),
              r.trashedAt(),
              r.trashedAt().plusDays(retentionDays),
              r.sizeBytes()));
    }
    return new DriveTrashListResponse(items);
  }

  /**
   * 폴더 복원 — 부모 보정·이름충돌 자동리네임을 '아직 trashed 인 상태'에서 먼저 처리한 뒤 op 단위 일괄 복원. EDITOR.
   *
   * <p>부분 유니크 인덱스 uq_drive_folder_name 은 trashed_at IS NULL 행만 검사한다. 따라서 이름/부모는 trashed 상태에서 확정해야
   * 하며, 그 뒤에야 restoreByOp 의 trashed_at=NULL 갱신이 유니크 위반 없이 통과한다(순서를 바꾸면 동명 충돌 시 롤백됨). 충돌은 trash_root
   * 에서만 발생 가능(아직 trashed 인 부모 밑에는 살아있는 동명 폴더를 만들 수 없으므로 하위는 충돌하지 않음).
   */
  @Transactional
  public void restoreFolder(long callerId, long folderId) {
    var meta =
        folders
            .findTrashRoot(folderId)
            .orElseThrow(
                () ->
                    new com.workplace.drive.exception.DriveNotInTrashException("folder", folderId));
    perms.requireRole(meta.spaceId(), callerId, "EDITOR");
    // 1) 부모 보정 — 원래 부모가 없거나(영구삭제) 아직 휴지통이면 루트로
    Long parent = meta.parentId();
    if (parent != null && !folders.liveFolderExists(parent)) {
      folders.setParentToRoot(folderId);
      parent = null;
    }
    // 2) 살아있는 형제와 이름 충돌 시 자동 리네임 — 아직 trashed 라 부분 인덱스에 안 걸림
    String name = resolveFolderName(meta.spaceId(), parent, meta.name(), folderId);
    if (!name.equals(meta.name())) folders.rename(folderId, name);
    // 3) 안전한 이름/부모 확정 후 op 단위 일괄 복원(trashed_at=NULL)
    folders.restoreByOp(meta.opId());
    files.restoreByOp(meta.opId());
  }

  /**
   * 파일 복원 — 이름 충돌 자동 리네임을 '아직 trashed 인 상태'에서 먼저 처리한 뒤 op 단위 복원 + 폴더 보정. EDITOR.
   *
   * <p>부분 유니크 인덱스 uq_drive_file_active_name(V81)은 trashed_at IS NULL 행만 검사한다. 따라서 이름 확정은 반드시
   * trashed 상태에서 먼저 완료해야 하며, 그 뒤에야 restoreByOp 의 trashed_at=NULL 갱신이 충돌 없이 통과한다.
   */
  @Transactional
  public void restoreFile(long callerId, long driveFileId) {
    var meta =
        files
            .findTrashRoot(driveFileId)
            .orElseThrow(
                () ->
                    new com.workplace.drive.exception.DriveNotInTrashException(
                        "file", driveFileId));
    perms.requireRole(meta.spaceId(), callerId, "EDITOR");
    // 1) 복원 대상 폴더 확정 — 원래 부모가 없거나 아직 휴지통이면 루트
    Long targetFolderId = meta.folderId();
    if (targetFolderId != null && !folders.liveFolderExists(targetFolderId)) {
      files.setFolderToRoot(driveFileId);
      targetFolderId = null;
    }
    // 2) 살아있는 동명 파일과 충돌 시 자동 리네임 — 아직 trashed 라 부분 인덱스에 안 걸림
    String name = resolveFileName(meta.spaceId(), targetFolderId, meta.name());
    if (!name.equals(meta.name())) files.rename(driveFileId, name);
    // 3) 안전한 이름 확정 후 op 단위 복원(trashed_at=NULL)
    folders.restoreByOp(meta.opId());
    files.restoreByOp(meta.opId());
  }

  /** 파일 영구삭제 — trash_root 확인 후 blob 만료 + 행 하드삭제. EDITOR. */
  @Transactional
  public void purgeFile(long callerId, long driveFileId) {
    var meta =
        files
            .findTrashRoot(driveFileId)
            .orElseThrow(
                () ->
                    new com.workplace.drive.exception.DriveNotInTrashException(
                        "file", driveFileId));
    perms.requireRole(meta.spaceId(), callerId, "EDITOR");
    // 현재 버전뿐 아니라 전 버전 blob 모두 만료 처리 (#79)
    files.expireFiles(versions.fileIdsForDriveFile(driveFileId));
    files.delete(driveFileId);
  }

  /** 폴더 영구삭제 — 서브트리 blob 만료 + 행 하드삭제(CASCADE). EDITOR. */
  @Transactional
  public void purgeFolder(long callerId, long folderId) {
    var meta =
        folders
            .findTrashRoot(folderId)
            .orElseThrow(
                () ->
                    new com.workplace.drive.exception.DriveNotInTrashException("folder", folderId));
    perms.requireRole(meta.spaceId(), callerId, "EDITOR");
    files.expireFiles(folders.findFileIdsUnderFolder(folderId)); // 서브트리(중첩 op 포함) 전체
    folders.delete(folderId); // CASCADE
  }

  /** 휴지통 비우기 — 공간의 모든 trashed 행 제거. EDITOR. */
  @Transactional
  public void emptyTrash(long callerId, long spaceId) {
    perms.requireRole(spaceId, callerId, "EDITOR");
    files.expireFiles(files.trashedFileIds(spaceId));
    files.deleteTrashedInSpace(spaceId); // 파일 행 먼저
    folders.deleteTrashedRootsInSpace(spaceId); // 폴더(CASCADE)
  }

  /** cutoff 이전 trash_root 전체 영구삭제(스케줄 잡 진입). 권한 검사 없음(시스템). */
  @Transactional
  public void purgeExpired(java.time.OffsetDateTime cutoff) {
    for (long folderId : folders.expiredTrashRootFolderIds(cutoff)) {
      files.expireFiles(folders.findFileIdsUnderFolder(folderId));
      folders.delete(folderId);
    }
    // driveFileId 단위로 전 버전 blob 만료 후 행 삭제(ON DELETE CASCADE 로 drive_file_version 정리)
    for (long driveFileId : files.expiredTrashRootFileIds(cutoff)) {
      files.expireFiles(versions.fileIdsForDriveFile(driveFileId));
      files.delete(driveFileId);
    }
  }

  /** 보존기간(일) — 잡이 cutoff 계산에 사용. */
  public int retentionDays() {
    return retentionDays;
  }

  /**
   * 살아있는 형제 파일과 충돌하면 " (복원됨)", 그래도 충돌하면 " (2)", " (3)"… 부여. 파일은 아직 trashed 상태이므로 findActiveByName 의
   * trashed_at IS NULL 조건에 걸리지 않아 자기 자신과 충돌하지 않는다.
   */
  private String resolveFileName(long spaceId, Long folderId, String base) {
    if (files.findActiveByName(spaceId, folderId, base).isEmpty()) return base;
    String candidate = base + " (복원됨)";
    int n = 2;
    while (files.findActiveByName(spaceId, folderId, candidate).isPresent()) {
      candidate = base + " (" + n++ + ")";
    }
    return candidate;
  }

  /** 살아있는 형제 폴더와 충돌하면 " (복원됨)", 그래도 충돌하면 " (2)", " (3)"… 부여. */
  private String resolveFolderName(long spaceId, Long parentId, String base, long selfId) {
    if (!folders.existsInSpaceExcluding(spaceId, parentId, base, selfId)) return base;
    String candidate = base + " (복원됨)";
    int n = 2;
    while (folders.existsInSpaceExcluding(spaceId, parentId, candidate, selfId)) {
      candidate = base + " (" + n++ + ")";
    }
    return candidate;
  }

  /** 조상 폴더명을 '/' 로 결합(DriveSearchService.pathOf 와 동일 규약). 루트 직속은 빈 문자열. */
  private String pathOf(Long folderId, Map<Long, DriveFolderResponse> byId) {
    Deque<String> parts = new ArrayDeque<>();
    Long cur = folderId;
    int guard = 0;
    while (cur != null && byId.containsKey(cur) && guard++ < 1000) {
      DriveFolderResponse f = byId.get(cur);
      parts.addFirst(f.name());
      cur = f.parentId();
    }
    return String.join("/", parts);
  }
}
