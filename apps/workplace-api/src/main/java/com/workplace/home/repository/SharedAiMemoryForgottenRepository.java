package com.workplace.home.repository;

import static com.workplace.jooq.Tables.SHARED_AI_MEMORY_FORGOTTEN;

import com.workplace.global.ai.MemoryTextNormalizer;
import com.workplace.home.service.SharedSpace.SpaceKey;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.jooq.Condition;
import org.jooq.DSLContext;
import org.jooq.impl.DSL;
import org.springframework.stereotype.Repository;

/**
 * 공간 지운 기록(WP-386 스펙 4절) — 개인 AiMemoryForgottenRepository(WP-385)와 같은 겹침 조건(정규화 같음 OR 임베딩 거리 ≤ 상한)을
 * 공간 키로 거른다. 공간당 300행. <b>모든 쿼리는 공간 키로 거른다</b>(RLS 는 테넌트까지만). 테넌트 트랜잭션 안에서 부른다.
 */
@Repository
@RequiredArgsConstructor
public class SharedAiMemoryForgottenRepository {

  /** 공간당 상한 — 넘으면 오래된 것부터 지운다. */
  public static final int SPACE_CAP = 300;

  private final DSLContext dsl;

  private static Condition space(SpaceKey k) {
    return SharedAiMemoryRepository.inSpace(
        SHARED_AI_MEMORY_FORGOTTEN.SPACE_TYPE, SHARED_AI_MEMORY_FORGOTTEN.SPACE_ID, k);
  }

  /** 겹침 조건 — 개인 지운 기록과 같은 식(정규화 같음 OR 거리 ≤ 상한)을 이 표의 컬럼으로. */
  private static Condition overlap(String normalized, String vectorLiteral, double maxDistance) {
    return AiMemoryForgottenRepository.overlap(
        SHARED_AI_MEMORY_FORGOTTEN.NORMALIZED,
        SHARED_AI_MEMORY_FORGOTTEN.EMBEDDING,
        normalized,
        vectorLiteral,
        maxDistance);
  }

  /** 지운 내용 여러 건을 넣고 새 id 들을 돌려준다(빈 목록이면 아무것도 하지 않는다). */
  public List<Long> insertAll(SpaceKey k, List<String> contents) {
    if (contents.isEmpty()) return List.of();
    OffsetDateTime now = OffsetDateTime.now(ZoneOffset.UTC);
    var step =
        dsl.insertInto(
            SHARED_AI_MEMORY_FORGOTTEN,
            SHARED_AI_MEMORY_FORGOTTEN.SPACE_TYPE,
            SHARED_AI_MEMORY_FORGOTTEN.SPACE_ID,
            SHARED_AI_MEMORY_FORGOTTEN.CONTENT,
            SHARED_AI_MEMORY_FORGOTTEN.NORMALIZED,
            SHARED_AI_MEMORY_FORGOTTEN.CREATED_AT);
    for (String c : contents) {
      step = step.values(k.type(), k.id(), c, MemoryTextNormalizer.normalize(c), now);
    }
    return step.returning(SHARED_AI_MEMORY_FORGOTTEN.ID).fetch(SHARED_AI_MEMORY_FORGOTTEN.ID);
  }

  /**
   * 공간당 SPACE_CAP 을 넘는 오래된 기록(id 작은 것)을 지운다 — 지운 수. 경계는 최신부터 SPACE_CAP+1 번째 id 이고, 상한 이하면 경계가
   * 없어(NULL) 아무것도 지우지 않는다.
   */
  public int trimToCap(SpaceKey k) {
    var boundary =
        DSL.select(SHARED_AI_MEMORY_FORGOTTEN.ID)
            .from(SHARED_AI_MEMORY_FORGOTTEN)
            .where(space(k))
            .orderBy(SHARED_AI_MEMORY_FORGOTTEN.ID.desc())
            .limit(1)
            .offset(SPACE_CAP);
    return dsl.deleteFrom(SHARED_AI_MEMORY_FORGOTTEN)
        .where(space(k))
        .and(SHARED_AI_MEMORY_FORGOTTEN.ID.le(boundary))
        .execute();
  }

  /** 겹치는 기록이 있는가 — vectorLiteral 이 null 이면 정규화만 본다. 임베딩이 아직 빈 기록은 정규화로만 걸린다. */
  public boolean anyMatch(SpaceKey k, String normalized, String vectorLiteral, double maxDistance) {
    return dsl.fetchExists(
        SHARED_AI_MEMORY_FORGOTTEN, space(k).and(overlap(normalized, vectorLiteral, maxDistance)));
  }

  /** 겹치는 기록을 지운다(사람이 직접 다시 기억함) — 조건은 anyMatch 와 같다. 지운 수. */
  public int deleteMatching(
      SpaceKey k, String normalized, String vectorLiteral, double maxDistance) {
    return dsl.deleteFrom(SHARED_AI_MEMORY_FORGOTTEN)
        .where(space(k))
        .and(overlap(normalized, vectorLiteral, maxDistance))
        .execute();
  }

  /** 공간 기록 내용(id 순) — 상한 확인용. */
  public List<String> contents(SpaceKey k) {
    return dsl.select(SHARED_AI_MEMORY_FORGOTTEN.CONTENT)
        .from(SHARED_AI_MEMORY_FORGOTTEN)
        .where(space(k))
        .orderBy(SHARED_AI_MEMORY_FORGOTTEN.ID.asc())
        .fetch(SHARED_AI_MEMORY_FORGOTTEN.CONTENT);
  }
}
