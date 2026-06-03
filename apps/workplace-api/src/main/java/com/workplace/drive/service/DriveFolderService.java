package com.workplace.drive.service;

import com.workplace.drive.dto.DriveFileResponse;
import com.workplace.drive.dto.DriveFolderResponse;
import com.workplace.drive.dto.DriveItemListResponse;
import com.workplace.drive.exception.DriveDuplicateNameException;
import com.workplace.drive.exception.DriveFolderNotFoundException;
import com.workplace.drive.exception.DriveInvalidTargetException;
import com.workplace.drive.repository.DriveFileRepository;
import com.workplace.drive.repository.DriveFolderRepository;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** 폴더 CRUD + 항목(폴더+파일) 목록. */
@Service
@RequiredArgsConstructor
public class DriveFolderService {
  private final DriveFolderRepository folders;
  private final DriveFileRepository files;
  private final DrivePermissions perms;

  @Transactional
  public DriveFolderResponse create(long callerId, long spaceId, Long parentId, String name) {
    perms.requireRole(spaceId, callerId, "EDITOR");
    if (folders.existsInSpace(spaceId, parentId, name)) {
      throw new DriveDuplicateNameException(name);
    }
    long id = folders.insert(spaceId, parentId, name);
    return folders.findById(id).orElseThrow(() -> new DriveFolderNotFoundException(id));
  }

  @Transactional
  public DriveFolderResponse rename(long callerId, long folderId, String name) {
    requireFolderSpace(callerId, folderId, "EDITOR");
    folders.rename(folderId, name);
    return folders.findById(folderId).orElseThrow(() -> new DriveFolderNotFoundException(folderId));
  }

  @Transactional
  public void delete(long callerId, long folderId) {
    requireFolderSpace(callerId, folderId, "EDITOR");
    // 서브트리 파일 바이트 정리 위임(FILE.expires_at = now)
    List<Long> fileIds = folders.findFileIdsUnderFolder(folderId);
    files.expireFiles(fileIds);
    folders.delete(folderId); // 하위 폴더/파일 행은 CASCADE
  }

  @Transactional(readOnly = true)
  public DriveItemListResponse listItems(long callerId, long spaceId, Long parentId) {
    perms.requireRole(spaceId, callerId, "VIEWER");
    List<DriveFolderResponse> fl = folders.listChildFolders(spaceId, parentId);
    List<DriveFileResponse> fi = files.listInFolder(spaceId, parentId);
    return new DriveItemListResponse(fl, fi);
  }

  /** 이동 — 같은 공간 내 다른 부모로 parent_id 변경. 자신·하위로의 이동은 거부. */
  @Transactional
  public void move(long callerId, long folderId, Long targetParentId) {
    long spaceId =
        folders.findSpaceId(folderId).orElseThrow(() -> new DriveFolderNotFoundException(folderId));
    perms.requireRole(spaceId, callerId, "EDITOR");
    validateTarget(spaceId, folderId, targetParentId);
    String name =
        folders
            .findById(folderId)
            .orElseThrow(() -> new DriveFolderNotFoundException(folderId))
            .name();
    if (folders.existsInSpace(spaceId, targetParentId, name)) {
      throw new DriveDuplicateNameException(name);
    }
    folders.updateParent(folderId, targetParentId);
  }

  /** 대상 부모가 같은 공간이고 폴더 자신·하위(서브트리)가 아닌지 검증. null = 공간 루트. */
  private void validateTarget(long spaceId, long folderId, Long targetParentId) {
    if (targetParentId == null) {
      return;
    }
    long targetSpace =
        folders
            .findSpaceId(targetParentId)
            .orElseThrow(() -> new DriveFolderNotFoundException(targetParentId));
    if (targetSpace != spaceId) {
      throw new DriveInvalidTargetException("target folder in different space");
    }
    if (folders.findSubtreeFolderIds(folderId).contains(targetParentId)) {
      throw new DriveInvalidTargetException("cannot move/copy into its own subtree");
    }
  }

  private long requireFolderSpace(long callerId, long folderId, String minRole) {
    long spaceId =
        folders.findSpaceId(folderId).orElseThrow(() -> new DriveFolderNotFoundException(folderId));
    perms.requireRole(spaceId, callerId, minRole);
    return spaceId;
  }
}
