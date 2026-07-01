package com.workplace.drive.repository;

import java.util.ArrayList;
import java.util.List;
import org.jooq.DSLContext;
import org.jooq.Record;
import org.springframework.stereotype.Repository;

/**
 * Drive 콘텐츠 하이브리드 검색. 키워드(tsvector websearch) 랭크와 벡터(pgvector 코사인) 랭크를 RRF 로 병합. RLS 가 테넌트를,
 * drive_space_member 조인이 사용자 접근을 스코프한다. 벡터가 null 이면 키워드 전용. spaceId 가 있으면 해당 공간으로 결과를 추가 제한한다.
 */
@Repository
public class DriveContentSearchRepository {

  /** RRF 상수 k. */
  private static final int K = 60;

  /** 후보 풀(각 랭커가 가져올 상위 N). */
  private static final int CANDIDATES = 50;

  /** 미스 페널티 rank(후보 풀 밖 = 51). */
  private static final int MISS_RANK = CANDIDATES + 1;

  private final DSLContext dsl;

  public DriveContentSearchRepository(DSLContext dsl) {
    this.dsl = dsl;
  }

  /** 하이브리드 검색 결과 행. */
  public record ContentRow(
      long driveFileId,
      long fileId,
      long spaceId,
      String spaceName,
      String fileName,
      String mimeType,
      String snippet,
      double score) {}

  /**
   * 하이브리드(또는 키워드 전용) 검색 진입점.
   *
   * @param queryVec 쿼리 임베딩(null 이면 벡터 랭커 생략 → 키워드 전용 graceful degradation)
   * @param spaceId null 이면 테넌트 전역, 값이 있으면 해당 공간의 파일로만 결과를 제한
   */
  public List<ContentRow> hybridSearch(
      long userId, String query, float[] queryVec, int limit, Long spaceId) {
    if (queryVec != null) {
      return hybridSearchWithVector(userId, query, toVectorLiteral(queryVec), limit, spaceId);
    }
    return keywordOnlySearch(userId, query, limit, spaceId);
  }

  /**
   * 키워드 전용 검색(벡터 없음). vec CTE 를 제거해 null 바인딩 타입 추론 오류를 회피. RRF 점수 = 1/(K+rank_kw) + 1/(K+MISS_RANK)
   * — 벡터 랭커 부재 시 상수 페널티. spaceId 가 있으면 accessible CTE 에 공간 필터를 추가한다.
   */
  private List<ContentRow> keywordOnlySearch(long userId, String query, int limit, Long spaceId) {
    String spaceFilter = spaceId != null ? "AND df.space_id = ?" : "";
    String sql =
        """
        WITH accessible AS (
          SELECT df.id AS drive_file_id, df.file_id, df.space_id, ds.name AS space_name,
                 df.name AS file_name, f.mime_type, fe.search_tv, fe.extracted_text
          FROM file_extraction fe
          JOIN drive_file df ON df.file_id = fe.file_id
          JOIN drive_space_member m ON m.space_id = df.space_id AND m.user_id = ?
          JOIN drive_space ds ON ds.id = df.space_id
          JOIN file f ON f.id = fe.file_id
          WHERE fe.status = 'DONE'
          %s
        ),
        kw AS (
          SELECT drive_file_id,
                 row_number() OVER (ORDER BY ts_rank(search_tv, websearch_to_tsquery('simple', ?)) DESC) AS rnk
          FROM accessible
          WHERE search_tv @@ websearch_to_tsquery('simple', ?)
          ORDER BY ts_rank(search_tv, websearch_to_tsquery('simple', ?)) DESC
          LIMIT ?
        ),
        merged AS (
          SELECT a.drive_file_id, a.file_id, a.space_id, a.space_name, a.file_name, a.mime_type, a.extracted_text,
                 (1.0/(? + kw.rnk)) + (1.0/(? + ?)) AS score
          FROM accessible a
          JOIN kw ON kw.drive_file_id = a.drive_file_id
        )
        SELECT m.drive_file_id, m.file_id, m.space_id, m.space_name, m.file_name, m.mime_type, m.score,
               ts_headline('simple', m.extracted_text, websearch_to_tsquery('simple', ?),
                           'MaxFragments=2, MaxWords=18, MinWords=6') AS snippet
        FROM merged m
        ORDER BY m.score DESC
        LIMIT ?
        """
            .formatted(spaceFilter);
    List<Object> params = new ArrayList<>();
    params.add(userId);
    if (spaceId != null) params.add(spaceId);
    params.add(query);
    params.add(query);
    params.add(query);
    params.add(CANDIDATES);
    params.add(K);
    params.add(K);
    params.add(MISS_RANK);
    params.add(query);
    params.add(limit);
    return dsl.fetch(sql, params.toArray()).map(this::toRow);
  }

  /**
   * 키워드 + 벡터 하이브리드 검색. 두 랭커를 RRF 로 병합. 미접근 파일은 drive_space_member 조인으로 배제. spaceId 가 있으면 accessible
   * CTE 에 공간 필터를 추가한다.
   */
  private List<ContentRow> hybridSearchWithVector(
      long userId, String query, String vecLiteral, int limit, Long spaceId) {
    String spaceFilter = spaceId != null ? "AND df.space_id = ?" : "";
    String sql =
        """
        WITH accessible AS (
          SELECT df.id AS drive_file_id, df.file_id, df.space_id, ds.name AS space_name,
                 df.name AS file_name, f.mime_type, fe.search_tv, fe.embedding, fe.extracted_text
          FROM file_extraction fe
          JOIN drive_file df ON df.file_id = fe.file_id
          JOIN drive_space_member m ON m.space_id = df.space_id AND m.user_id = ?
          JOIN drive_space ds ON ds.id = df.space_id
          JOIN file f ON f.id = fe.file_id
          WHERE fe.status = 'DONE'
          %s
        ),
        kw AS (
          SELECT drive_file_id,
                 row_number() OVER (ORDER BY ts_rank(search_tv, websearch_to_tsquery('simple', ?)) DESC) AS rnk
          FROM accessible
          WHERE search_tv @@ websearch_to_tsquery('simple', ?)
          ORDER BY ts_rank(search_tv, websearch_to_tsquery('simple', ?)) DESC
          LIMIT ?
        ),
        vec AS (
          SELECT drive_file_id,
                 row_number() OVER (ORDER BY embedding <=> cast(? as vector)) AS rnk
          FROM accessible
          WHERE embedding IS NOT NULL
          ORDER BY embedding <=> cast(? as vector)
          LIMIT ?
        ),
        merged AS (
          SELECT a.drive_file_id, a.file_id, a.space_id, a.space_name, a.file_name, a.mime_type, a.extracted_text,
                 (1.0/(? + COALESCE(kw.rnk, ?))) + (1.0/(? + COALESCE(vec.rnk, ?))) AS score
          FROM accessible a
          LEFT JOIN kw  ON kw.drive_file_id  = a.drive_file_id
          LEFT JOIN vec ON vec.drive_file_id = a.drive_file_id
          WHERE kw.rnk IS NOT NULL OR vec.rnk IS NOT NULL
        )
        SELECT m.drive_file_id, m.file_id, m.space_id, m.space_name, m.file_name, m.mime_type, m.score,
               ts_headline('simple', m.extracted_text, websearch_to_tsquery('simple', ?),
                           'MaxFragments=2, MaxWords=18, MinWords=6') AS snippet
        FROM merged m
        ORDER BY m.score DESC
        LIMIT ?
        """
            .formatted(spaceFilter);
    List<Object> params = new ArrayList<>();
    params.add(userId);
    if (spaceId != null) params.add(spaceId);
    params.add(query);
    params.add(query);
    params.add(query);
    params.add(CANDIDATES);
    params.add(vecLiteral);
    params.add(vecLiteral);
    params.add(CANDIDATES);
    params.add(K);
    params.add(MISS_RANK);
    params.add(K);
    params.add(MISS_RANK);
    params.add(query);
    params.add(limit);
    return dsl.fetch(sql, params.toArray()).map(this::toRow);
  }

  private ContentRow toRow(Record r) {
    return new ContentRow(
        ((Number) r.get("drive_file_id")).longValue(),
        ((Number) r.get("file_id")).longValue(),
        ((Number) r.get("space_id")).longValue(),
        (String) r.get("space_name"),
        (String) r.get("file_name"),
        (String) r.get("mime_type"),
        (String) r.get("snippet"),
        ((Number) r.get("score")).doubleValue());
  }

  /** float[] → pgvector 리터럴. */
  static String toVectorLiteral(float[] v) {
    StringBuilder sb = new StringBuilder("[");
    for (int i = 0; i < v.length; i++) {
      if (i > 0) sb.append(',');
      sb.append(v[i]);
    }
    return sb.append(']').toString();
  }
}
