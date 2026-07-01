package com.workplace.drive.service;

import com.workplace.drive.dto.DriveContentHit;
import com.workplace.drive.dto.DriveContentSearchResponse;
import com.workplace.drive.outbound.WorkerEmbedClient;
import com.workplace.drive.repository.DriveContentSearchRepository;
import com.workplace.global.util.UnicodeNames;
import java.util.List;
import java.util.Optional;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** 콘텐츠 검색. 쿼리를 임베딩(실패 시 키워드 전용)하고 하이브리드 RRF 로 접근 가능 파일을 랭킹한다. spaceId 지정 시 해당 공간으로 제한. */
@Service
public class DriveContentSearchService {

  /** 최소 검색어 길이. */
  private static final int MIN_QUERY = 2;

  /** 기본 결과 수. */
  private static final int DEFAULT_LIMIT = 10;

  private static final int MAX_LIMIT = 50;

  private final DriveContentSearchRepository repo;
  private final WorkerEmbedClient embedClient;

  public DriveContentSearchService(
      DriveContentSearchRepository repo, WorkerEmbedClient embedClient) {
    this.repo = repo;
    this.embedClient = embedClient;
  }

  /**
   * 콘텐츠 하이브리드 검색. 쿼리 벡터 획득 실패 시 키워드 전용으로 우아하게 강등.
   *
   * @param userId 호출자 id (RLS + 멤버십 필터에 사용)
   * @param q 검색어 (null 또는 2자 미만이면 빈 결과 반환)
   * @param limit 최대 결과 수 (null 이면 기본값 10, 상한 50)
   * @param spaceId null 이면 테넌트 전역, 값이 있으면 해당 공간으로 결과 제한
   */
  @Transactional(readOnly = true)
  public DriveContentSearchResponse search(long userId, String q, Integer limit, Long spaceId) {
    // 검색어 NFC 정규화 — 본문 tsvector(추출 텍스트=NFC)와 일관되게 매칭(UnicodeNames 참조).
    String norm = q == null ? "" : UnicodeNames.toNfc(q).trim();
    if (norm.length() < MIN_QUERY) {
      return new DriveContentSearchResponse(List.of(), false);
    }
    int lim = limit == null ? DEFAULT_LIMIT : Math.min(Math.max(limit, 1), MAX_LIMIT);
    // 임베딩 실패 시 empty → 키워드 전용으로 강등(워커 장애가 검색을 죽이지 않는다)
    Optional<float[]> vec = embedClient.embedQuery(norm);
    List<DriveContentHit> hits =
        repo.hybridSearch(userId, norm, vec.orElse(null), lim, spaceId).stream()
            .map(
                r ->
                    new DriveContentHit(
                        r.driveFileId(),
                        r.fileId(),
                        r.spaceId(),
                        r.spaceName(),
                        r.fileName(),
                        r.mimeType(),
                        r.snippet(),
                        r.score()))
            .toList();
    return new DriveContentSearchResponse(hits, vec.isPresent());
  }
}
