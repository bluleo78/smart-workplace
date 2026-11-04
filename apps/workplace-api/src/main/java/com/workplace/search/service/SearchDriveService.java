package com.workplace.search.service;

import com.workplace.drive.dto.DriveFolderResponse;
import com.workplace.drive.repository.DriveFolderRepository;
import com.workplace.drive.repository.DriveNameSearchRepository;
import com.workplace.drive.repository.DriveNameSearchRepository.NameRow;
import com.workplace.global.util.UnicodeNames;
import com.workplace.search.dto.DriveNameHit;
import com.workplace.search.dto.DriveNamePage;
import java.util.ArrayDeque;
import java.util.Deque;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 통합 검색 팔레트(WP-1353)의 드라이브 이름 검색 — 호출자가 멤버인 모든 공간을 한 번에 본다. 공간 이름 검색({@code DriveSearchService})과
 * 같은 규칙으로 검색어를 정리하고 결과마다 조상 폴더 경로를 붙이되, 경로는 결과 묶음이 걸친 공간의 폴더를 한 번에 읽어 만든다(건마다 조회하지 않는다).
 */
@Service
@RequiredArgsConstructor
public class SearchDriveService {

  /** 최소 검색어 길이(미만이면 빈 결과) — 공간 이름 검색과 같다. */
  private static final int MIN_QUERY = 2;

  private final DriveNameSearchRepository nameSearch;
  private final DriveFolderRepository folders;

  /** 이름 검색 한 페이지. RLS 가 드라이브 테이블을 막으므로 읽기 트랜잭션 안에서 돈다. size+1 건을 읽어 다음 페이지 유무를 판정한다. */
  @Transactional(readOnly = true)
  public DriveNamePage search(long callerId, String q, int offset, int size) {
    // 저장 이름이 NFC 라 검색어도 NFC 로 맞춘다(맥에서 복사한 NFD 검색어 대응) — DriveSearchService 와 같다.
    String norm = q == null ? "" : UnicodeNames.toNfc(q).trim();
    if (norm.length() < MIN_QUERY) {
      return new DriveNamePage(List.of(), false);
    }
    List<NameRow> rows = nameSearch.search(callerId, norm, size + 1, offset);
    boolean hasMore = rows.size() > size;
    List<NameRow> page = hasMore ? rows.subList(0, size) : rows;

    // 결과가 걸친 공간의 폴더만 한 번에 읽어 id→폴더 맵을 만든다.
    Set<Long> spaceIds = new HashSet<>();
    page.forEach(r -> spaceIds.add(r.spaceId()));
    Map<Long, DriveFolderResponse> byId = new HashMap<>();
    for (DriveFolderResponse f : folders.listAllFolders(spaceIds)) {
      byId.put(f.id(), f);
    }

    List<DriveNameHit> items =
        page.stream()
            .map(
                r ->
                    new DriveNameHit(
                        r.folder() ? "FOLDER" : "FILE",
                        r.id(),
                        r.spaceId(),
                        r.spaceName(),
                        r.folderId(),
                        r.name(),
                        r.mimeType(),
                        pathOf(r.folderId(), byId)))
            .toList();
    return new DriveNamePage(items, hasMore);
  }

  /** 조상 폴더명을 " / " 로 이은 경로. 루트 직속(folderId null)은 빈 문자열. */
  private static String pathOf(Long folderId, Map<Long, DriveFolderResponse> byId) {
    Deque<String> parts = new ArrayDeque<>();
    Long cur = folderId;
    int guard = 0;
    while (cur != null && byId.containsKey(cur) && guard++ < 1000) {
      DriveFolderResponse f = byId.get(cur);
      parts.addFirst(f.name());
      cur = f.parentId();
    }
    return String.join(" / ", parts);
  }
}
