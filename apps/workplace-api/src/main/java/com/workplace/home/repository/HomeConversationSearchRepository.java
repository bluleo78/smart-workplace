package com.workplace.home.repository;

import static com.workplace.home.service.AiMemoryRanker.CANDIDATES;
import static com.workplace.home.service.AiMemoryRanker.K;
import static com.workplace.home.service.AiMemoryRanker.MISS_RANK;
import static com.workplace.home.service.AiMemoryRanker.SEMANTIC_MAX_DISTANCE;

import com.workplace.global.util.LikePatternUtils;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
import org.jooq.Record;
import org.springframework.stereotype.Repository;

/**
 * 지난 대화 검색(WP-384) — 호출자 본인 대화(home_session.user_id, 테넌트는 RLS)의 메시지에서 키워드 후보(USER·ASSISTANT 전문검색 +
 * 낱말별 ILIKE, 상위 50)와 의미 후보(완료 답 임베딩 코사인 거리 SEMANTIC_MAX_DISTANCE 이하, 상위 50)를 RRF(K=60, 미스 51)로 합치고,
 * 대화마다 최고 점수 메시지 하나를 대표로 상위 limit 개 대화를 돌려준다. 메시지가 많아 SQL CTE 안에서 후보를 자른다(판정 7). 질의 임베딩이 없으면 의미 CTE
 * 를 빼 null 벡터 바인딩을 피한다 (DriveContentSearchRepository 와 같은 방식). ILIKE 는 `ESCAPE '\'` 를 명시해
 * LikePatternUtils 이스케이프를 받는다.
 */
@Repository
@RequiredArgsConstructor
public class HomeConversationSearchRepository {

  private final DSLContext dsl;

  /**
   * 대화 하나의 대표 턴 — 대표 메시지가 ASSISTANT 면 직전 USER 가 질문, USER 면 같은 턴(다음 USER 전)의 첫 ASSISTANT 가 답. 없는 쪽은
   * null.
   */
  public record Hit(
      UUID sessionId,
      long messageId,
      String title,
      Instant lastMessageAt,
      String question,
      String answer) {}

  /**
   * @param terms {@code SearchTerms.of(query)} — 비면 전문검색만
   * @param queryVec 질의 임베딩(없으면 null — 키워드만)
   * @param excludeSessionId 지금 대화(없으면 null)
   */
  public List<Hit> search(
      long userId,
      String query,
      List<String> terms,
      float[] queryVec,
      UUID excludeSessionId,
      int limit) {
    List<Object> p = new ArrayList<>();
    StringBuilder sql = new StringBuilder();
    sql.append(
        "WITH mine AS (SELECT m.id, m.session_id, m.role, m.content, to_tsvector('simple', m.content) AS search_tv, m.embedding"
            + " FROM home_message m JOIN home_session s ON s.id = m.session_id"
            + " WHERE s.user_id = ? AND m.content <> ''");
    p.add(userId);
    if (excludeSessionId != null) {
      sql.append(" AND s.id <> ?");
      p.add(excludeSessionId);
    }
    sql.append(
        "), kw AS (SELECT id, row_number() OVER (ORDER BY hits DESC, rnk DESC, id DESC) AS r FROM ("
            + "SELECT id, (CASE WHEN search_tv @@ websearch_to_tsquery('simple', ?) THEN 1 ELSE 0 END");
    p.add(query);
    for (String t : terms) {
      sql.append(" + CASE WHEN content ILIKE ? ESCAPE '\\' THEN 1 ELSE 0 END");
      p.add(LikePatternUtils.containsPattern(t));
    }
    sql.append(
        ") AS hits, ts_rank(search_tv, websearch_to_tsquery('simple', ?)) AS rnk FROM mine) x"
            + " WHERE hits > 0 ORDER BY hits DESC, rnk DESC, id DESC LIMIT ?)");
    p.add(query);
    p.add(CANDIDATES);
    if (queryVec != null) {
      String literal = TextEmbeddingRepository.vectorLiteral(queryVec);
      // 거리 상한 안의 답만 의미 후보 — 상위 50 만으로 자르면 임베딩된 답은 질의와 무관해도 늘 들어 관련 없는 대화가 나온다.
      sql.append(
          ", vec AS (SELECT id, row_number() OVER (ORDER BY d, id DESC) AS r FROM ("
              + "SELECT id, embedding <=> cast(? as vector) AS d"
              + " FROM mine WHERE role = 'ASSISTANT' AND embedding IS NOT NULL) v"
              + " WHERE d <= ? ORDER BY d, id DESC LIMIT ?)");
      p.add(literal);
      p.add(SEMANTIC_MAX_DISTANCE);
      p.add(CANDIDATES);
      sql.append(
          ", scored AS (SELECT m.id, m.session_id, m.role,"
              + " 1.0/(? + COALESCE(kw.r, ?)) + 1.0/(? + COALESCE(vec.r, ?)) AS score"
              + " FROM mine m LEFT JOIN kw ON kw.id = m.id LEFT JOIN vec ON vec.id = m.id"
              + " WHERE kw.r IS NOT NULL OR vec.r IS NOT NULL)");
    } else {
      sql.append(
          ", scored AS (SELECT m.id, m.session_id, m.role,"
              + " 1.0/(? + COALESCE(kw.r, ?)) + 1.0/(? + ?) AS score"
              + " FROM mine m JOIN kw ON kw.id = m.id)");
    }
    p.add(K);
    p.add(MISS_RANK);
    p.add(K);
    p.add(MISS_RANK);
    sql.append(
        ", best AS (SELECT DISTINCT ON (session_id) session_id, id, role, score FROM scored"
            + " ORDER BY session_id, score DESC, id DESC)"
            + " SELECT b.session_id, b.id AS message_id, s.title, s.last_message_at,"
            // 대표 턴의 질문·답을 한 번에 — 히트마다 따로 묻지 않는다. USER 대표의 답은 다음 USER 메시지 전까지만 본다(답이 없는
            // 질문이 뒤 턴의 답이나 중단·실패한 빈 답과 짝지어지지 않게).
            + " CASE WHEN b.role = 'ASSISTANT' THEN (SELECT u.content FROM home_message u"
            + "   WHERE u.session_id = b.session_id AND u.role = 'USER' AND u.id < b.id"
            + "   ORDER BY u.id DESC LIMIT 1) ELSE m.content END AS question,"
            + " CASE WHEN b.role = 'ASSISTANT' THEN m.content ELSE (SELECT a.content FROM home_message a"
            + "   WHERE a.session_id = b.session_id AND a.role = 'ASSISTANT' AND a.content <> '' AND a.id > b.id"
            + "   AND a.id < COALESCE((SELECT min(n.id) FROM home_message n"
            + "     WHERE n.session_id = b.session_id AND n.role = 'USER' AND n.id > b.id),"
            + "     9223372036854775807)"
            + "   ORDER BY a.id ASC LIMIT 1) END AS answer"
            + " FROM best b JOIN home_session s ON s.id = b.session_id"
            + " JOIN home_message m ON m.id = b.id"
            + " ORDER BY b.score DESC, s.last_message_at DESC LIMIT ?");
    p.add(limit);
    return dsl.fetch(sql.toString(), p.toArray()).map(HomeConversationSearchRepository::toHit);
  }

  private static Hit toHit(Record r) {
    OffsetDateTime last = r.get("last_message_at", OffsetDateTime.class);
    return new Hit(
        r.get("session_id", UUID.class),
        r.get("message_id", Long.class),
        r.get("title", String.class),
        last == null ? null : last.toInstant(),
        r.get("question", String.class),
        r.get("answer", String.class));
  }
}
