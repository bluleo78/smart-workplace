package com.workplace.drive.service;

import com.workplace.drive.dto.DriveFileResponse;
import com.workplace.drive.dto.DriveFolderPathSegment;
import com.workplace.drive.dto.DriveFolderResponse;
import com.workplace.drive.dto.DriveItemListResponse;
import com.workplace.drive.exception.DriveDuplicateNameException;
import com.workplace.drive.exception.DriveFolderNotFoundException;
import com.workplace.drive.exception.DriveInvalidTargetException;
import com.workplace.drive.repository.DriveFileRepository;
import com.workplace.drive.repository.DriveFolderRepository;
import com.workplace.file.service.FileUploadService;
import com.workplace.global.util.UnicodeNames;
import java.io.IOException;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
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
  private final FileUploadService fileUpload;
  private final org.jooq.DSLContext dsl;

  @Transactional
  public DriveFolderResponse create(long callerId, long spaceId, Long parentId, String name) {
    perms.requireRole(spaceId, callerId, "EDITOR");
    name = UnicodeNames.toNfc(name); // 폴더명 NFC 정규화 — 중복검사·검색이 저장값과 일관되도록(UnicodeNames 참조).
    if (folders.existsInSpace(spaceId, parentId, name)) {
      throw new DriveDuplicateNameException(name);
    }
    long id = folders.insert(spaceId, parentId, name);
    return folders.findById(id).orElseThrow(() -> new DriveFolderNotFoundException(id));
  }

  /**
   * 폴더 merge 해석 — 같은 (space, parent, name) live 폴더가 있으면 그 id 를 반환하고, 없으면 새로 만든다. 폴더 업로드의 구조
   * 재생(merge-on-conflict)에서 사용한다.
   */
  @Transactional
  public DriveFolderResponse resolveOrCreate(
      long callerId, long spaceId, Long parentId, String name) {
    perms.requireRole(spaceId, callerId, "EDITOR");
    String nfcName = UnicodeNames.toNfc(name); // 폴더명 NFC 정규화(merge 키 일관). 람다 캡처 위해 별도 final 지역변수.
    return folders
        .findIdInSpace(spaceId, parentId, nfcName)
        .flatMap(folders::findById)
        .orElseGet(
            () -> {
              long id = folders.insert(spaceId, parentId, nfcName);
              return folders.findById(id).orElseThrow(() -> new DriveFolderNotFoundException(id));
            });
  }

  @Transactional
  public DriveFolderResponse rename(long callerId, long folderId, String name) {
    requireFolderSpace(callerId, folderId, "EDITOR");
    name = UnicodeNames.toNfc(name); // 폴더명 NFC 정규화(검색 일관).
    folders.rename(folderId, name);
    return folders.findById(folderId).orElseThrow(() -> new DriveFolderNotFoundException(folderId));
  }

  /** 삭제 = 휴지통으로(soft, 통째). 살아있는 서브트리 전체를 같은 op 로 마킹. blob 보존. */
  @Transactional
  public void delete(long callerId, long folderId) {
    requireFolderSpace(callerId, folderId, "EDITOR");
    long opId = dsl.nextval(com.workplace.jooq.Sequences.DRIVE_TRASH_OP_SEQ);
    folders.markSubtreeTrashed(folderId, opId);
  }

  @Transactional(readOnly = true)
  public DriveItemListResponse listItems(long callerId, long spaceId, Long parentId) {
    perms.requireRole(spaceId, callerId, "VIEWER");
    List<DriveFolderResponse> fl = folders.listChildFolders(spaceId, parentId);
    List<DriveFileResponse> fi = files.listInFolder(spaceId, parentId);
    return new DriveItemListResponse(fl, fi);
  }

  /**
   * 폴더의 조상 경로(루트→대상) 세그먼트 목록 — breadcrumb 용. 공간 전체 폴더를 1회 로드해 부모 체인을 거슬러 올라간 뒤 역순(루트가 앞)으로 반환한다.
   * 사이클 가드(1000).
   */
  @Transactional(readOnly = true)
  public List<DriveFolderPathSegment> path(long callerId, long folderId) {
    long spaceId =
        folders.findSpaceId(folderId).orElseThrow(() -> new DriveFolderNotFoundException(folderId));
    perms.requireRole(spaceId, callerId, "VIEWER");
    Map<Long, DriveFolderResponse> byId = new HashMap<>();
    for (DriveFolderResponse f : folders.listAllFolders(spaceId)) {
      byId.put(f.id(), f);
    }
    Deque<DriveFolderPathSegment> parts = new ArrayDeque<>();
    Long cur = folderId;
    int guard = 0;
    while (cur != null && byId.containsKey(cur) && guard++ < 1000) {
      DriveFolderResponse f = byId.get(cur);
      parts.addFirst(new DriveFolderPathSegment(f.id(), f.name()));
      cur = f.parentId();
    }
    // 사이클로 가드가 트립되면 조용히 잘린 경로를 반환하지 않고 손상 데이터를 감지 가능하게 예외
    if (guard >= 1000) {
      throw new IllegalStateException("폴더 경로 사이클 감지: folderId=" + folderId);
    }
    return new ArrayList<>(parts);
  }

  /** 이동 — 같은 공간 내 다른 부모로 parent_id 변경. 자신·하위로의 이동은 거부. */
  @Transactional
  public void move(long callerId, long folderId, Long targetParentId) {
    DriveFolderResponse self =
        folders.findById(folderId).orElseThrow(() -> new DriveFolderNotFoundException(folderId));
    long spaceId =
        folders.findSpaceId(folderId).orElseThrow(() -> new DriveFolderNotFoundException(folderId));
    perms.requireRole(spaceId, callerId, "EDITOR");
    validateTarget(spaceId, folderId, targetParentId);
    // 같은 부모로의 이동은 no-op — 자기 자신과의 이름 충돌로 인한 잘못된 409 방지
    if (java.util.Objects.equals(self.parentId(), targetParentId)) {
      return;
    }
    if (folders.existsInSpace(spaceId, targetParentId, self.name())) {
      throw new DriveDuplicateNameException(self.name());
    }
    folders.updateParent(folderId, targetParentId);
  }

  /**
   * 복사 — 폴더 서브트리 전체를 대상 부모 밑으로 재귀 복제. 각 파일은 blob 물리 복제(영구).
   *
   * <p>단일 `@Transactional` — 중간 실패 시 복제된 모든 folder·file·drive_file row 가 함께 롤백된다(부분 커밋 없음). 단일 txn
   * 이라 임시-expiry→promote 단계는 불필요. 디스크 blob 고아 가능성(드문 실패경로)은 copyFile 주석 참조.
   */
  @Transactional
  public DriveFolderResponse copy(long callerId, long folderId, Long targetParentId)
      throws IOException {
    long spaceId =
        folders.findSpaceId(folderId).orElseThrow(() -> new DriveFolderNotFoundException(folderId));
    perms.requireRole(spaceId, callerId, "EDITOR");
    validateTarget(spaceId, folderId, targetParentId);
    DriveFolderResponse src =
        folders.findById(folderId).orElseThrow(() -> new DriveFolderNotFoundException(folderId));
    if (folders.existsInSpace(spaceId, targetParentId, src.name())) {
      throw new DriveDuplicateNameException(src.name());
    }
    long newRootId = copyTree(callerId, spaceId, folderId, targetParentId, src.name());
    return folders
        .findById(newRootId)
        .orElseThrow(() -> new DriveFolderNotFoundException(newRootId));
  }

  /** 한 폴더를 대상 밑에 만들고, 그 안의 파일(blob 복제)·하위 폴더를 재귀 복제. 새 루트 폴더 id 반환. */
  private long copyTree(
      long callerId, long spaceId, long srcFolderId, Long destParentId, String name)
      throws IOException {
    long newFolderId = folders.insert(spaceId, destParentId, name);
    for (DriveFileResponse f : files.listInFolder(spaceId, srcFolderId)) {
      long newFid = fileUpload.copyFile(f.fileId(), callerId);
      // insertWithInitialVersion 으로 폴더 복사 내 파일도 v1 버전 행 생성(#79 불변식 강제)
      files.insertWithInitialVersion(
          spaceId, newFolderId, newFid, f.name(), f.sizeBytes(), callerId);
    }
    for (DriveFolderResponse child : folders.listChildFolders(spaceId, srcFolderId)) {
      copyTree(callerId, spaceId, child.id(), newFolderId, child.name());
    }
    return newFolderId;
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
      throw new DriveInvalidTargetException("다른 공간으로는 이동/복사할 수 없습니다.");
    }
    if (folders.findSubtreeFolderIds(folderId).contains(targetParentId)) {
      throw new DriveInvalidTargetException("폴더 자신 또는 하위 폴더로는 이동/복사할 수 없습니다.");
    }
  }

  private long requireFolderSpace(long callerId, long folderId, String minRole) {
    long spaceId =
        folders.findSpaceId(folderId).orElseThrow(() -> new DriveFolderNotFoundException(folderId));
    perms.requireRole(spaceId, callerId, minRole);
    return spaceId;
  }
}
