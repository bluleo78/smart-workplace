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
