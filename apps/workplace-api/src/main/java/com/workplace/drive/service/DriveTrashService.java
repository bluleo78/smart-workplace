package com.workplace.drive.service;

import com.workplace.drive.dto.DriveFolderResponse;
import com.workplace.drive.dto.DriveTrashItemResponse;
import com.workplace.drive.dto.DriveTrashListResponse;
import com.workplace.drive.repository.DriveFileRepository;
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

  /** 폴더 복원 — op 단위 일괄 + 부모 보정 + 이름충돌 자동리네임. EDITOR. */
  @Transactional
  public void restoreFolder(long callerId, long folderId) {
    var meta =
        folders
            .findTrashRoot(folderId)
            .orElseThrow(
                () ->
                    new com.workplace.drive.exception.DriveNotInTrashException("folder", folderId));
    perms.requireRole(meta.spaceId(), callerId, "EDITOR");
    folders.restoreByOp(meta.opId());
    files.restoreByOp(meta.opId());
    Long parent = meta.parentId();
    if (parent != null && !folders.liveFolderExists(parent)) {
      folders.setParentToRoot(folderId);
      parent = null;
    }
    String name = resolveFolderName(meta.spaceId(), parent, meta.name(), folderId);
    if (!name.equals(meta.name())) folders.rename(folderId, name);
  }

  /** 파일 복원 — op 단위 일괄 + 폴더 보정. 파일명은 충돌 제약 없음. EDITOR. */
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
    folders.restoreByOp(meta.opId());
    files.restoreByOp(meta.opId());
    if (meta.folderId() != null && !folders.liveFolderExists(meta.folderId())) {
      files.setFolderToRoot(driveFileId);
    }
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
    files.fileIdOf(driveFileId).ifPresent(fid -> files.expireFiles(java.util.List.of(fid)));
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
