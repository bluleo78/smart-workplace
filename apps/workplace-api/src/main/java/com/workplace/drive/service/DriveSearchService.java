package com.workplace.drive.service;

import com.workplace.drive.dto.DriveFileHit;
import com.workplace.drive.dto.DriveFolderHit;
import com.workplace.drive.dto.DriveFolderResponse;
import com.workplace.drive.dto.DriveSearchResponse;
import com.workplace.drive.repository.DriveFileRepository;
import com.workplace.drive.repository.DriveFolderRepository;
import com.workplace.global.util.UnicodeNames;
import java.util.ArrayDeque;
import java.util.Deque;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** 공간 전체 이름 검색. 폴더/파일을 ILIKE 매칭하고 각 항목에 조상 폴더 경로를 부여한다. */
@Service
@RequiredArgsConstructor
public class DriveSearchService {
  private final DriveFileRepository files;
  private final DriveFolderRepository folders;
  private final DrivePermissions perms;

  /** 최소 검색어 길이(미만이면 빈 결과). */
  private static final int MIN_QUERY = 2;

  @Transactional(readOnly = true)
  public DriveSearchResponse search(long callerId, long spaceId, String q) {
    perms.requireRole(spaceId, callerId, "VIEWER");
    // 검색어도 NFC 로 정규화한다. 저장 이름이 NFC 이므로 쿼리가 NFD(예: 맥 파일명에서 복사)로 와도 매칭되도록 통일(UnicodeNames 참조).
    String norm = q == null ? "" : UnicodeNames.toNfc(q).trim();
    if (norm.length() < MIN_QUERY) {
      return new DriveSearchResponse(List.of(), List.of());
    }

    // 경로 계산용 id→폴더 맵(공간의 모든 폴더 1회 로드).
    Map<Long, DriveFolderResponse> byId = new HashMap<>();
    for (DriveFolderResponse f : folders.listAllFolders(spaceId)) {
      byId.put(f.id(), f);
    }

    List<DriveFolderHit> folderHits =
        folders.searchByName(spaceId, norm).stream()
            .map(
                f ->
                    new DriveFolderHit(
                        f.id(), f.parentId(), f.name(), f.createdAt(), pathOf(f.parentId(), byId)))
            .toList();

    List<DriveFileHit> fileHits =
        files.searchByName(spaceId, norm).stream()
            .map(
                f ->
                    new DriveFileHit(
                        f.id(),
                        f.folderId(),
                        f.fileId(),
                        f.name(),
                        f.mimeType(),
                        f.sizeBytes(),
                        f.category(),
                        f.createdAt(),
                        pathOf(f.folderId(), byId)))
            .toList();

    return new DriveSearchResponse(folderHits, fileHits);
  }

  /** 조상 폴더명을 '/' 로 결합한 경로. 루트 직속(folderId null)은 빈 문자열. */
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
