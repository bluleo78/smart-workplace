package com.workplace.home.repository;

import static com.workplace.jooq.Tables.AI_MEMORY;

import com.workplace.global.util.LikePatternUtils;
import com.workplace.home.repository.AiMemoryRepository.Row;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
import org.jooq.Field;
import org.jooq.impl.DSL;
import org.jooq.impl.SQLDataType;
import org.springframework.stereotype.Repository;

/**
 * 메모리 순위 재료(WP-383, 판정 7) — 후보 행마다 전문검색 일치·ts_rank·질의 낱말 ILIKE 일치 수·코사인 거리를 한 번에 돌려준다. 합치기(RRF)는
 * 자바(AiMemoryRanker)에서 한다 — 사용자당 후보가 수백 행이라 SQL CTE 를 세 갈래로 나눌 이유가 없고, 벡터는 DB 밖으로 나오지 않는다. 사용자 필터 뒤
 * 정확 탐색이라 벡터 인덱스를 쓰지 않는다.
 */
@Repository
@RequiredArgsConstructor
public class AiMemoryRankRepository {

  private final DSLContext dsl;

  /**
   * 한 행의 순위 재료.
   *
   * @param ftsMatch search_tv @@ websearch_to_tsquery('simple', 질의) — 질의에 낱말이 없으면 false
   * @param ftsRank ts_rank(일치하지 않으면 0)
   * @param termHits 질의 낱말(조사 뗀 형태 포함) 중 내용에 부분 일치한 수
   * @param distance 질의 임베딩과의 코사인 거리 — 질의 임베딩이 없거나 행 임베딩이 비었으면 null(의미 미스)
   */
  public record Scored(Row row, boolean ftsMatch, double ftsRank, int termHits, Double distance) {}

  /**
   * 범위 필터의 유효 행마다 순위 재료. query 는 공백을 걷어 낸 원문(전문검색용), terms 는 {@code SearchTerms.of(query)},
   * queryVec 은 질의 임베딩(없으면 null — 의미 재료를 빼고 바인딩 타입 문제를 피한다).
   */
  public List<Scored> score(
      long userId,
      LocalDate today,
      ScopeFilter filter,
      String query,
      List<String> terms,
      float[] queryVec) {
    Field<Boolean> ftsMatch =
        DSL.field(
                "{0} @@ websearch_to_tsquery('simple', {1})",
                Boolean.class, AI_MEMORY.SEARCH_TV, DSL.val(query))
            .as("fts_match");
    Field<Double> ftsRank =
        DSL.field(
                "ts_rank({0}, websearch_to_tsquery('simple', {1}))",
                Double.class, AI_MEMORY.SEARCH_TV, DSL.val(query))
            .as("fts_rank");
    Field<Integer> termHits = termHits(terms).as("term_hits");
    Field<Double> distance =
        (queryVec == null
                ? DSL.castNull(SQLDataType.DOUBLE)
                : DSL.field(
                    "{0} <=> cast({1} as vector)",
                    Double.class,
                    AI_MEMORY.EMBEDDING,
                    DSL.val(TextEmbeddingRepository.vectorLiteral(queryVec))))
            .as("distance");
    List<Field<?>> fields = new ArrayList<>(AiMemoryRepository.ROW_FIELDS);
    fields.addAll(List.of(ftsMatch, ftsRank, termHits, distance));
    return dsl.select(fields)
        .from(AI_MEMORY)
        .where(AI_MEMORY.USER_ID.eq(userId))
        .and(filter.condition())
        .and(AiMemoryRepository.active(today))
        .fetch(
            r ->
                new Scored(
                    AiMemoryRepository.toRow(r),
                    Boolean.TRUE.equals(r.get(ftsMatch)),
                    r.get(ftsRank) == null ? 0 : r.get(ftsRank),
                    r.get(termHits) == null ? 0 : r.get(termHits),
                    r.get(distance)));
  }

  /**
   * 낱말마다 {@code content ILIKE '%낱말%' ESCAPE '\'} 이면 1 — 합이 일치 수. 낱말은 기호를 담지 않지만(SearchTerms) 그래도
   * escape 한다. 낱말이 없으면 0.
   */
  static Field<Integer> termHits(List<String> terms) {
    Field<Integer> sum = DSL.inline(0);
    for (String t : terms) {
      sum =
          sum.plus(
              DSL.when(
                      AI_MEMORY.CONTENT.likeIgnoreCase(LikePatternUtils.containsPattern(t), '\\'),
                      DSL.inline(1))
                  .otherwise(DSL.inline(0)));
    }
    return sum;
  }
}
