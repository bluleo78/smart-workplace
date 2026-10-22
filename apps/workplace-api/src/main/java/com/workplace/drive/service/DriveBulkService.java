package com.workplace.drive.service;

import static com.workplace.global.realtime.ResourceChangedEvent.OP_DELETED;
import static com.workplace.global.realtime.ResourceChangedEvent.OP_UPDATED;

import com.workplace.audit.service.AuditLogService;
import com.workplace.drive.exception.DriveFileNotFoundException;
import com.workplace.drive.exception.DriveFolderNotFoundException;
import com.workplace.drive.exception.DriveInvalidTargetException;
import com.workplace.drive.outbound.DriveChangeNotifier;
import com.workplace.drive.repository.DriveFileRepository;
import com.workplace.drive.repository.DriveFolderRepository;
import com.workplace.user.repository.UserRepository;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 벌크 이동/삭제 오케스트레이션. 모든 항목은 같은 공간(컨트롤러 spaceId)이어야 하며, 한 항목이라도 실패하면 전체 롤백된다(단일 트랜잭션). 삭제는 배치 전체가 하나의
 * trash_op_id 를 공유해 한 번의 복원으로 되돌린다.
 */
@Service
@RequiredArgsConstructor
public class DriveBulkService {
  private final DriveFileRepository files;
  private final DriveFolderRepository folders;
  private final DrivePermissions perms;
  private final org.jooq.DSLContext dsl;
  private final AuditLogService auditLogService;
  private final UserRepository userRepository;
  private final DriveFileService fileService;
  private final DriveFolderService folderService;

  /** 드라이브 변경 resource.changed 발행(WP-63) — 일괄 작업은 이벤트 1건에 ids 를 묶는다. */
  private final DriveChangeNotifier notifier;

  /**
   * 벌크 삭제 — 선택된 파일/폴더를 휴지통으로(soft). 배치 전체가 동일 op-id 공유. 항목이 요청 공간(spaceId)에 속하지 않으면
   * DriveInvalidTargetException 으로 전체 롤백.
   */
  @Transactional
  public void bulkDelete(long callerId, long spaceId, List<Long> fileIds, List<Long> folderIds) {
    perms.requireRole(spaceId, callerId, "EDITOR");
    // 같은 id 를 두 번 넣으면 두 번째가 이미 휴지통이라 404 로 전부 실패했다 — 한 번만, 개수는 상한까지(WP-795).
    DriveBulkSelection selection = DriveBulkSelection.of(fileIds, folderIds);
    fileIds = selection.fileIds();
    folderIds = selection.folderIds();
    // 1) 표시 전에 모두 확인한다 — 없는 항목·다른 공간 항목이 있으면 아무것도 지우지 않고 거절(404·400).
    Map<Long, DriveFileRepository.DriveFileRow> fileRows = new LinkedHashMap<>();
    if (folderIds != null) {
      for (Long folderId : folderIds) {
        long fSpace =
            folders
                .findSpaceId(folderId)
                .orElseThrow(() -> new DriveFolderNotFoundException(folderId));
        if (fSpace != spaceId) {
          throw new DriveInvalidTargetException("다른 공간의 폴더는 포함할 수 없습니다.");
        }
      }
    }
    if (fileIds != null) {
      for (Long fileId : fileIds) {
        DriveFileRepository.DriveFileRow row =
            files.findRow(fileId).orElseThrow(() -> new DriveFileNotFoundException(fileId));
        if (row.spaceId() != spaceId) {
          throw new DriveInvalidTargetException("다른 공간의 파일은 포함할 수 없습니다.");
        }
        fileRows.put(fileId, row);
      }
    }

    long opId = dsl.nextval(com.workplace.jooq.Sequences.DRIVE_TRASH_OP_SEQ);
    String username = usernameOf(callerId);
    // 2) 부모 폴더와 그 안의 폴더·파일을 함께 고르면 안쪽 항목은 부모와 함께 지워지므로 따로 표시하지 않는다(WP-782). 예전엔 부모를 먼저 표시한 뒤
    // 안쪽 항목을 「찾을 수 없음」 404 로 보고 전체를 실패시켰다. 안쪽 폴더를 따로 표시하면 휴지통 최상위(trash_root)로도 잘못 남는다.
    // 고른 폴더마다 하위(자기 제외)를 한 번씩만 모은다 — 어느 고른 폴더의 하위인 고른 폴더는 최상위로 표시하지 않는다.
    Set<Long> covered = new HashSet<>(); // 고른 폴더들의 서브트리(자기 포함) — 그 안의 고른 파일은 함께 지워진다
    Set<Long> nested = new HashSet<>(); // 다른 고른 폴더의 하위
    if (folderIds != null) {
      for (Long folderId : folderIds) {
        for (Long sub : folders.findSubtreeFolderIds(folderId)) {
          covered.add(sub);
          if (!sub.equals(folderId)) nested.add(sub);
        }
      }
      for (Long folderId : folderIds) {
        if (!nested.contains(folderId)) folders.markSubtreeTrashed(folderId, opId);
      }
    }
    for (DriveFileRepository.DriveFileRow row : fileRows.values()) {
      long fileId = row.id();
      if (row.folderId() != null && covered.contains(row.folderId())) continue; // 고른 폴더와 함께 지워짐
      files.markTrashed(fileId, opId);
      // 단건 삭제와 동일하게 FILE_DELETE 감사 로그를 남긴다(#81).
      auditLogService.log(
          callerId,
          username,
          "FILE_DELETE",
          "drive",
          String.valueOf(fileId),
          "드라이브 파일 삭제(벌크): " + row.name(),
          null,
          null,
          "SUCCESS",
          null,
          Map.of("spaceId", spaceId, "fileName", row.name(), "bulkOpId", opId));
    }
    notifier.itemsChanged(OP_DELETED, spaceId, union(fileIds, folderIds), callerId);
  }

  /**
   * 벌크 이동 — 선택된 파일/폴더를 targetFolderId 로 이동. 단건 move 로직(권한·같은공간·self/subtree·이름충돌 검증 포함)을 그대로 재사용하며,
   * 한 항목이라도 실패하면 단일 트랜잭션으로 전체 롤백한다.
   */
  @Transactional
  public void bulkMove(
      long callerId, long spaceId, List<Long> fileIds, List<Long> folderIds, Long targetFolderId) {
    perms.requireRole(spaceId, callerId, "EDITOR");
    // 같은 id 반복은 한 번만, 개수는 상한까지(WP-795) — 같은 id 2만 개로 요청 하나가 16초 걸렸다.
    DriveBulkSelection selection = DriveBulkSelection.of(fileIds, folderIds);
    fileIds = selection.fileIds();
    folderIds = selection.folderIds();
    // 항목별 단건 move 는 각자의 공간에서 검증되므로, 통지는 실제 이동된 항목의 공간별로 묶는다.
    // 단건 move 가 해결한 공간 id 를 반환하므로 항목마다 공간을 사전 조회하지 않는다(없는 항목은 move 가 404 를 던진다).
    Map<Long, List<Long>> idsBySpace = new LinkedHashMap<>();
    if (folderIds != null) {
      for (Long folderId : folderIds) {
        long fSpace = folderService.move(callerId, folderId, targetFolderId, false);
        idsBySpace.computeIfAbsent(fSpace, k -> new ArrayList<>()).add(folderId);
      }
    }
    if (fileIds != null) {
      for (Long fileId : fileIds) {
        long fSpace = fileService.move(callerId, fileId, targetFolderId, false);
        idsBySpace.computeIfAbsent(fSpace, k -> new ArrayList<>()).add(fileId);
      }
    }
    // 단건 move 는 notify=false 로 발행을 껐으므로 여기서 공간당 1건으로 묶어 발행한다(같은 공간이면 1건).
    idsBySpace.forEach((sid, ids) -> notifier.itemsChanged(OP_UPDATED, sid, ids, callerId));
  }

  /** null 허용 두 id 목록의 합집합(이벤트 ids 용). */
  private static List<Long> union(List<Long> a, List<Long> b) {
    List<Long> all = new ArrayList<>();
    if (a != null) all.addAll(a);
    if (b != null) all.addAll(b);
    return all;
  }

  /** 감사 로그용 사용자명. 없으면 id 문자열. */
  private String usernameOf(long userId) {
    return userRepository
        .findById(userId)
        .map(com.workplace.user.dto.UserResponse::username)
        .orElse(String.valueOf(userId));
  }
}
