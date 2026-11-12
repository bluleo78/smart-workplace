package com.workplace.help.repository;

import com.workplace.home.repository.TextEmbeddingRepository;
import java.util.Collection;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.jooq.DSLContext;
import org.jooq.Record;
import org.springframework.stereotype.Repository;

/** 도움말 매뉴얼 절 색인 저장소(WP-1509). 제품 공용 표(help_manual_section, 테넌트·RLS 없음)라 plain SQL 로 다룬다. */
@Repository
public class HelpManualSectionRepository {

  private final DSLContext dsl;

  public HelpManualSectionRepository(DSLContext dsl) {
    this.dsl = dsl;
  }

  /** 색인할 절 한 행. */
  public record SectionRow(
      String sectionId,
      String chapter,
      String chapterTitle,
      String title,
      String label,
      List<String> audience,
      String body,
      String contentHash,
      int ord) {}

  /** 색인된 절의 변경 판정용 요약 — 해시가 덮지 않는 값(장 id·대상·순서)까지 함께 들고 있다. */
  public record StoredMeta(String contentHash, String chapter, List<String> audience, int ord) {}

  /** 검색 후보 한 행 — distance 는 질의 벡터가 없거나 행 임베딩이 비면 null. */
  public record ScoredRow(
      String sectionId,
      String chapter,
      String title,
      String label,
      String body,
      int ord,
      Double distance) {}

  /**
   * 절을 넣거나 고친다. 해시가 같으면 임베딩을 유지하고, 다르면 내용을 갈고 embedding 을 NULL 로 되돌린다. 순서·대상·updated_at 은 해시와 무관하게
   * 갱신한다(안 바뀐 절은 호출자가 건너뛴다 — {@link #snapshot()}). 반환값은 처리한 행이 있는지.
   */
  public boolean upsert(SectionRow r) {
    Integer n =
        dsl.fetchOne(
                "WITH up AS ("
                    + " INSERT INTO help_manual_section"
                    + " (section_id, chapter, chapter_title, title, label, audience, body, content_hash, ord)"
                    + " VALUES (?, ?, ?, ?, ?, cast(? as text[]), ?, ?, ?)"
                    + " ON CONFLICT (section_id) DO UPDATE SET"
                    + " chapter = excluded.chapter, chapter_title = excluded.chapter_title,"
                    + " title = excluded.title, label = excluded.label,"
                    + " audience = excluded.audience, body = excluded.body, ord = excluded.ord,"
                    + " embedding = CASE WHEN help_manual_section.content_hash = excluded.content_hash"
                    + "   THEN help_manual_section.embedding ELSE NULL END,"
                    + " content_hash = excluded.content_hash, updated_at = now()"
                    + " RETURNING 1) SELECT count(*)::int FROM up",
                r.sectionId(),
                r.chapter(),
                r.chapterTitle(),
                r.title(),
                r.label(),
                arrayLiteral(r.audience()),
                r.body(),
                r.contentHash(),
                r.ord())
            .get(0, Integer.class);
    return n != null && n > 0;
  }

  /** 주어진 id 에 없는 절을 지운다. 지운 수. ids 가 비면 전부 지운다. */
  public int deleteNotIn(Collection<String> ids) {
    if (ids.isEmpty()) return dsl.execute("DELETE FROM help_manual_section");
    return dsl.execute(
        "DELETE FROM help_manual_section WHERE section_id <> ALL(cast(? as text[]))",
        arrayLiteral(ids));
  }

  /** 지금 색인된 절의 id → 변경 판정용 요약(해시·장 id·대상·순서). 안 바뀐 절의 upsert 를 건너뛰는 데 쓴다. */
  public Map<String, StoredMeta> snapshot() {
    Map<String, StoredMeta> m = new HashMap<>();
    for (Record rec :
        dsl.fetch(
            "SELECT section_id, content_hash, chapter, audience, ord FROM help_manual_section")) {
      m.put(
          rec.get("section_id", String.class),
          new StoredMeta(
              rec.get("content_hash", String.class),
              rec.get("chapter", String.class),
              audience(rec),
              rec.get("ord", Integer.class)));
    }
    return m;
  }

  /** 임베딩이 빈 절 최대 max 개(묶음 순서). */
  public List<SectionRow> missingEmbedding(int max) {
    return dsl.fetch(
            "SELECT section_id, chapter, chapter_title, title, label, audience, body,"
                + " content_hash, ord FROM help_manual_section WHERE embedding IS NULL"
                + " ORDER BY ord LIMIT ?",
            max)
        .map(HelpManualSectionRepository::toSectionRow);
  }

  /** 행 → SectionRow(색인 열 전부를 고른 결과에서). */
  private static SectionRow toSectionRow(Record rec) {
    return new SectionRow(
        rec.get("section_id", String.class),
        rec.get("chapter", String.class),
        rec.get("chapter_title", String.class),
        rec.get("title", String.class),
        rec.get("label", String.class),
        audience(rec),
        rec.get("body", String.class),
        rec.get("content_hash", String.class),
        rec.get("ord", Integer.class));
  }

  /** audience 배열 열 → 목록. */
  private static List<String> audience(Record rec) {
    return List.of(rec.get("audience", String[].class));
  }

  /**
   * 절 임베딩을 쓴다. 읽을 때의 content_hash 가 지금도 같을 때만 쓴다 — 임베딩하는 사이 다른 sync 가 내용을 바꿔 embedding 을 NULL 로
   * 되돌렸다면 옛 벡터가 덮어쓰지 않게(다음 refresh 가 새 내용으로 다시 채운다). 쓴 행 수(0 이면 그사이 바뀌었거나 지워짐).
   */
  public int saveEmbedding(String id, String contentHash, float[] v) {
    return dsl.execute(
        "UPDATE help_manual_section SET embedding = cast(? as vector)"
            + " WHERE section_id = ? AND content_hash = ?",
        TextEmbeddingRepository.vectorLiteral(v),
        id,
        contentHash);
  }

  /**
   * 볼 수 있는 절 전부(대상 규칙: audience 가 비었거나 'member' 를 품으면 보임, 'admin' 만 있으면 includeAdmin 일 때만). 질의 벡터와
   * 행 임베딩이 둘 다 있으면 코사인 거리, 아니면 null. 묶음 순서로 돌려준다.
   */
  public List<ScoredRow> visibleSections(boolean includeAdmin, float[] queryOrNull) {
    String vec = queryOrNull == null ? null : TextEmbeddingRepository.vectorLiteral(queryOrNull);
    return dsl.fetch(
            "SELECT section_id, chapter, title, label, body, ord,"
                + " CASE WHEN ?::text IS NOT NULL AND embedding IS NOT NULL"
                + "   THEN embedding <=> cast(?::text as vector) END AS distance"
                + " FROM help_manual_section"
                + " WHERE cardinality(audience) = 0 OR 'member' = ANY(audience)"
                + "   OR (? AND 'admin' = ANY(audience))"
                + " ORDER BY ord",
            vec,
            vec,
            includeAdmin)
        .map(
            rec ->
                new ScoredRow(
                    rec.get("section_id", String.class),
                    rec.get("chapter", String.class),
                    rec.get("title", String.class),
                    rec.get("label", String.class),
                    rec.get("body", String.class),
                    rec.get("ord", Integer.class),
                    rec.get("distance", Double.class)));
  }

  /** 문자열 목록 → Postgres 배열 리터럴 {"a","b"}(따옴표·역슬래시 이스케이프). */
  private static String arrayLiteral(Collection<String> values) {
    StringBuilder sb = new StringBuilder("{");
    boolean first = true;
    for (String v : values) {
      if (!first) sb.append(',');
      first = false;
      sb.append('"').append(v.replace("\\", "\\\\").replace("\"", "\\\"")).append('"');
    }
    return sb.append('}').toString();
  }
}
