package com.workplace.drive.service;

import com.workplace.audit.service.AuditLogService;
import com.workplace.drive.exception.DriveFileNotFoundException;
import com.workplace.drive.exception.DriveFolderNotFoundException;
import com.workplace.drive.exception.DriveInvalidTargetException;
import com.workplace.drive.repository.DriveFileRepository;
import com.workplace.drive.repository.DriveFolderRepository;
import com.workplace.user.repository.UserRepository;
import java.util.List;
import java.util.Map;
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

  /**
   * 벌크 삭제 — 선택된 파일/폴더를 휴지통으로(soft). 배치 전체가 동일 op-id 공유. 항목이 요청 공간(spaceId)에 속하지 않으면
   * DriveInvalidTargetException 으로 전체 롤백.
   */
  @Transactional
  public void bulkDelete(long callerId, long spaceId, List<Long> fileIds, List<Long> folderIds) {
    perms.requireRole(spaceId, callerId, "EDITOR");
    long opId = dsl.nextval(com.workplace.jooq.Sequences.DRIVE_TRASH_OP_SEQ);
    String username = usernameOf(callerId);

    if (folderIds != null) {
      for (Long folderId : folderIds) {
        long fSpace =
            folders
                .findSpaceId(folderId)
                .orElseThrow(() -> new DriveFolderNotFoundException(folderId));
        if (fSpace != spaceId) {
          throw new DriveInvalidTargetException("folder not in space: " + folderId);
        }
        folders.markSubtreeTrashed(folderId, opId);
      }
    }
    if (fileIds != null) {
      for (Long fileId : fileIds) {
        DriveFileRepository.DriveFileRow row =
            files.findRow(fileId).orElseThrow(() -> new DriveFileNotFoundException(fileId));
        if (row.spaceId() != spaceId) {
          throw new DriveInvalidTargetException("file not in space: " + fileId);
        }
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
    }
  }

  /**
   * 벌크 이동 — 선택된 파일/폴더를 targetFolderId 로 이동. 단건 move 로직(권한·같은공간·self/subtree·이름충돌 검증 포함)을 그대로 재사용하며,
   * 한 항목이라도 실패하면 단일 트랜잭션으로 전체 롤백한다.
   */
  @Transactional
  public void bulkMove(
      long callerId, long spaceId, List<Long> fileIds, List<Long> folderIds, Long targetFolderId) {
    perms.requireRole(spaceId, callerId, "EDITOR");
    if (folderIds != null) {
      for (Long folderId : folderIds) {
        folderService.move(callerId, folderId, targetFolderId);
      }
    }
    if (fileIds != null) {
      for (Long fileId : fileIds) {
        fileService.move(callerId, fileId, targetFolderId);
      }
    }
  }

  /** 감사 로그용 사용자명. 없으면 id 문자열. */
  private String usernameOf(long userId) {
    return userRepository
        .findById(userId)
        .map(com.workplace.user.dto.UserResponse::username)
        .orElse(String.valueOf(userId));
  }
}
