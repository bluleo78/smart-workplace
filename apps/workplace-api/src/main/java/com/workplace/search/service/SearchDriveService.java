package com.workplace.search.service;

import com.workplace.drive.dto.DriveFolderResponse;
import com.workplace.drive.repository.DriveFolderRepository;
import com.workplace.drive.repository.DriveNameSearchRepository;
import com.workplace.drive.repository.DriveNameSearchRepository.NameRow;
import com.workplace.drive.service.DriveFolderPaths;
import com.workplace.global.util.UnicodeNames;
import com.workplace.search.dto.DriveNameHit;
import com.workplace.search.dto.DriveNamePage;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.function.Function;
import java.util.stream.Collectors;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 통합 검색 팔레트(WP-1353)의 드라이브 이름 검색 — 호출자가 멤버인 모든 공간을 한 번에 본다. 공간 이름 검색({@code DriveSearchService})과
 * 같은 규칙으로 검색어를 정리하고 결과마다 조상 폴더 경로를 붙이되, 경로는 결과 행의 조상 폴더만 재귀로 한 번에 읽어 만든다(건마다·공간 전체를 읽지 않는다).
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

    // 결과 행이 담긴 폴더와 그 조상만 재귀로 읽어 id→폴더 맵을 만든다(공간 전체를 읽지 않는다).
    Set<Long> folderIds =
        page.stream().map(NameRow::folderId).filter(Objects::nonNull).collect(Collectors.toSet());
    Map<Long, DriveFolderResponse> byId =
        folders.listWithAncestors(folderIds).stream()
            .collect(Collectors.toMap(DriveFolderResponse::id, Function.identity()));

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
                        DriveFolderPaths.pathOf(r.folderId(), byId)))
            .toList();
    return new DriveNamePage(items, hasMore);
  }
}
