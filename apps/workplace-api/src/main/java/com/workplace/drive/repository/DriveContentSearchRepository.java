package com.workplace.drive.repository;

import java.util.List;
import org.jooq.DSLContext;
import org.jooq.Record;
import org.springframework.stereotype.Repository;

/**
 * Drive 콘텐츠 하이브리드 검색. 키워드(tsvector websearch) 랭크와 벡터(pgvector 코사인) 랭크를 RRF 로 병합. RLS 가 테넌트를,
 * drive_space_member 조인이 사용자 접근을 스코프한다. 벡터가 null 이면 키워드 전용.
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
   */
  public List<ContentRow> hybridSearch(long userId, String query, float[] queryVec, int limit) {
    if (queryVec != null) {
      return hybridSearchWithVector(userId, query, toVectorLiteral(queryVec), limit);
    }
    return keywordOnlySearch(userId, query, limit);
  }

  /**
   * 키워드 전용 검색(벡터 없음). vec CTE 를 제거해 null 바인딩 타입 추론 오류를 회피. RRF 점수 = 1/(K+rank_kw) + 1/(K+MISS_RANK)
   * — 벡터 랭커 부재 시 상수 페널티.
   */
  private List<ContentRow> keywordOnlySearch(long userId, String query, int limit) {
    // 키워드 랭커(websearch_to_tsquery, 'simple')만 사용. 미접근 파일은 drive_space_member 조인으로 배제.
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
        """;
    return dsl.fetch(
            sql,
            userId, // accessible.member
            query,
            query,
            query, // kw: OVER rank, WHERE filter, ORDER BY, LIMIT
            CANDIDATES,
            K,
            K,
            MISS_RANK, // score: 1/(K+rank_kw) + 1/(K+MISS_RANK)
            query,
            limit) // headline + limit
        .map(this::toRow);
  }

  /** 키워드 + 벡터 하이브리드 검색. 두 랭커를 RRF 로 병합. 미접근 파일은 drive_space_member 조인으로 배제. */
  private List<ContentRow> hybridSearchWithVector(
      long userId, String query, String vecLiteral, int limit) {
    // 키워드 랭커(websearch_to_tsquery, 'simple') + 벡터 랭커(<=> 코사인)를 각각 상위 CANDIDATES 로 뽑아
    // RRF 점수 = 1/(K+rank_kw) + 1/(K+rank_vec) 로 병합. 미접근 파일은 drive_space_member 조인으로 배제.
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
        """;
    return dsl.fetch(
            sql,
            userId, // accessible.member
            query,
            query,
            query, // kw: OVER rank, WHERE filter, ORDER BY, LIMIT
            CANDIDATES,
            vecLiteral,
            vecLiteral,
            CANDIDATES, // vec: order, order, limit
            K,
            MISS_RANK,
            K,
            MISS_RANK, // merged RRF
            query,
            limit) // headline + limit
        .map(this::toRow);
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
