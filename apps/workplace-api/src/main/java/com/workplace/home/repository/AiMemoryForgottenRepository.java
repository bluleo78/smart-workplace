package com.workplace.home.repository;

import static com.workplace.jooq.Tables.AI_MEMORY_FORGOTTEN;

import com.workplace.global.ai.MemoryTextNormalizer;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.jooq.Condition;
import org.jooq.DSLContext;
import org.jooq.Field;
import org.jooq.impl.DSL;
import org.springframework.stereotype.Repository;

/**
 * 지운 기록(WP-385 스펙 6) — 사용자가 지우게 한 메모리 내용. 배경 정리 결과가 이것과 겹치면(정규화 같음 또는 임베딩 거리 상한 이하) 버린다. <b>모든 쿼리는
 * user_id 로 거른다</b>(RLS 는 테넌트까지만). 테넌트는 RLS(GUC)·tenant_id DEFAULT 가 정하므로 테넌트 트랜잭션 안에서 부른다. 벡터 비교는
 * plain SQL {@code <=> cast(? as vector)}(AiMemoryRankRepository 와 같은 방식).
 */
@Repository
@RequiredArgsConstructor
public class AiMemoryForgottenRepository {

  /** 사용자당 상한 — 넘으면 오래된 것부터 지운다(스펙 3). */
  public static final int USER_CAP = 500;

  private final DSLContext dsl;

  /** 지운 내용 여러 건을 넣고 새 id 들을 돌려준다(빈 목록이면 아무것도 하지 않는다). */
  public List<Long> insertAll(long userId, List<String> contents) {
    if (contents.isEmpty()) return List.of();
    OffsetDateTime now = OffsetDateTime.now(ZoneOffset.UTC);
    var step =
        dsl.insertInto(
            AI_MEMORY_FORGOTTEN,
            AI_MEMORY_FORGOTTEN.USER_ID,
            AI_MEMORY_FORGOTTEN.CONTENT,
            AI_MEMORY_FORGOTTEN.NORMALIZED,
            AI_MEMORY_FORGOTTEN.CREATED_AT);
    for (String c : contents) {
      step = step.values(userId, c, MemoryTextNormalizer.normalize(c), now);
    }
    return step.returning(AI_MEMORY_FORGOTTEN.ID).fetch(AI_MEMORY_FORGOTTEN.ID);
  }

  /**
   * 사용자당 USER_CAP 을 넘는 오래된 기록(id 작은 것)을 지운다 — 지운 수. 경계는 최신부터 USER_CAP+1 번째 id 이고, 상한 이하면 경계가
   * 없어(NULL) 아무것도 지우지 않는다 — 대부분인 상한 이하 넣기에서 사용자 기록 전체를 훑지 않는다.
   */
  public int trimToCap(long userId) {
    return dsl.execute(
        "DELETE FROM ai_memory_forgotten WHERE user_id = ? AND id <="
            + " (SELECT id FROM ai_memory_forgotten WHERE user_id = ? ORDER BY id DESC"
            + " OFFSET ? LIMIT 1)",
        userId,
        userId,
        USER_CAP);
  }

  /**
   * 겹치는 기록이 있는가 — 정규화 문장이 같거나(빈 문장은 제외) 임베딩 코사인 거리가 maxDistance 이하. vectorLiteral 이 null 이면 정규화만
   * 본다. 임베딩이 아직 빈 기록은 거리 비교가 NULL 이라 정규화로만 걸린다.
   */
  public boolean anyMatch(
      long userId, String normalized, String vectorLiteral, double maxDistance) {
    return dsl.fetchExists(
        AI_MEMORY_FORGOTTEN,
        AI_MEMORY_FORGOTTEN
            .USER_ID
            .eq(userId)
            .and(overlap(normalized, vectorLiteral, maxDistance)));
  }

  /** 겹치는 기록을 지운다(사용자가 직접 다시 기억함) — 조건은 anyMatch 와 같다. 지운 수. */
  public int deleteMatching(
      long userId, String normalized, String vectorLiteral, double maxDistance) {
    return dsl.deleteFrom(AI_MEMORY_FORGOTTEN)
        .where(AI_MEMORY_FORGOTTEN.USER_ID.eq(userId))
        .and(overlap(normalized, vectorLiteral, maxDistance))
        .execute();
  }

  /** 겹침 조건 — 정규화 같음 OR (벡터가 있으면) 거리 상한 이하. */
  private static Condition overlap(String normalized, String vectorLiteral, double maxDistance) {
    return overlap(
        AI_MEMORY_FORGOTTEN.NORMALIZED,
        AI_MEMORY_FORGOTTEN.EMBEDDING,
        normalized,
        vectorLiteral,
        maxDistance);
  }

  /** 표·컬럼을 받는 같은 조건 — 공간 지운 기록 저장소(WP-386)도 쓴다. 정규화 문장이 같거나(빈 문장은 제외) 벡터가 있으면 코사인 거리가 상한 이하. */
  static Condition overlap(
      Field<String> normalizedField,
      Field<?> embeddingField,
      String normalized,
      String vectorLiteral,
      double maxDistance) {
    Condition c =
        normalized == null || normalized.isEmpty()
            ? DSL.falseCondition()
            : normalizedField.eq(normalized);
    if (vectorLiteral == null) return c;
    return c.or(
        DSL.condition(
            "{0} <=> cast({1} as vector) <= {2}",
            embeddingField, DSL.val(vectorLiteral), DSL.val(maxDistance)));
  }
}
