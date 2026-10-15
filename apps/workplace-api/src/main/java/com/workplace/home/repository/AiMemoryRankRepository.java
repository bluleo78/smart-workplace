package com.workplace.home.repository;

import static com.workplace.jooq.Tables.AI_MEMORY;

import com.workplace.global.util.LikePatternUtils;
import com.workplace.home.repository.AiMemoryRepository.Row;
import com.workplace.home.service.RrfRanking;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.function.Function;
import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
import org.jooq.Field;
import org.jooq.Record;
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
  public record Scored(Row row, boolean ftsMatch, double ftsRank, int termHits, Double distance)
      implements RrfRanking.Material {}

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
    RankColumns c =
        RankColumns.of(
            AI_MEMORY.SEARCH_TV, AI_MEMORY.CONTENT, AI_MEMORY.EMBEDDING, query, terms, queryVec);
    List<Field<?>> fields = new ArrayList<>(AiMemoryRepository.ROW_FIELDS);
    fields.addAll(c.asList());
    return dsl.select(fields)
        .from(AI_MEMORY)
        .where(AI_MEMORY.USER_ID.eq(userId))
        .and(filter.condition())
        .and(AiMemoryRepository.active(today))
        .fetch(r -> c.read(r, AiMemoryRepository::toRow, Scored::new));
  }

  /**
   * 순위 재료 컬럼 넷(WP-386 이 공용 메모리 저장소와 함께 쓰도록 표·컬럼을 인자로 받는다) — 전문검색 일치·ts_rank·낱말 ILIKE 일치 수·코사인 거리.
   * 같은 식을 두 저장소가 복사하지 않게 한 곳에 둔다.
   */
  record RankColumns(
      Field<Boolean> ftsMatch,
      Field<Double> ftsRank,
      Field<Integer> termHits,
      Field<Double> distance) {

    /** 컬럼 만들기 — queryVec 이 null 이면 거리는 NULL 상수(바인딩 타입 문제를 피한다). */
    static RankColumns of(
        Field<?> searchTv,
        Field<String> content,
        Field<?> embedding,
        String query,
        List<String> terms,
        float[] queryVec) {
      return new RankColumns(
          DSL.field(
                  "{0} @@ websearch_to_tsquery('simple', {1})",
                  Boolean.class, searchTv, DSL.val(query))
              .as("fts_match"),
          DSL.field(
                  "ts_rank({0}, websearch_to_tsquery('simple', {1}))",
                  Double.class, searchTv, DSL.val(query))
              .as("fts_rank"),
          AiMemoryRankRepository.termHits(content, terms).as("term_hits"),
          (queryVec == null
                  ? DSL.castNull(SQLDataType.DOUBLE)
                  : DSL.field(
                      "{0} <=> cast({1} as vector)",
                      Double.class,
                      embedding,
                      DSL.val(TextEmbeddingRepository.vectorLiteral(queryVec))))
              .as("distance"));
    }

    /** Scored 레코드를 만드는 생성자 모양 — 개인·공용이 각자의 행 타입으로 같은 읽기 코드를 쓴다. */
    @FunctionalInterface
    interface ScoredFactory<R, S> {
      S of(R row, boolean ftsMatch, double ftsRank, int termHits, Double distance);
    }

    /** 결과 한 줄 → Scored. NULL 은 일치 없음(false)·0 으로 읽고 거리는 NULL 그대로(의미 미스). */
    <R, S> S read(Record r, Function<Record, R> toRow, ScoredFactory<R, S> factory) {
      return factory.of(
          toRow.apply(r),
          Boolean.TRUE.equals(r.get(ftsMatch)),
          r.get(ftsRank) == null ? 0 : r.get(ftsRank),
          r.get(termHits) == null ? 0 : r.get(termHits),
          r.get(distance));
    }

    /** SELECT 에 덧붙일 컬럼 목록. */
    List<Field<?>> asList() {
      return List.of(ftsMatch, ftsRank, termHits, distance);
    }
  }

  /**
   * 낱말마다 {@code content ILIKE '%낱말%' ESCAPE '\'} 이면 1 — 합이 일치 수. 낱말은 기호를 담지 않지만(SearchTerms) 그래도
   * escape 한다. 낱말이 없으면 0.
   */
  static Field<Integer> termHits(Field<String> content, List<String> terms) {
    Field<Integer> sum = DSL.inline(0);
    for (String t : terms) {
      sum =
          sum.plus(
              DSL.when(
                      content.likeIgnoreCase(LikePatternUtils.containsPattern(t), '\\'),
                      DSL.inline(1))
                  .otherwise(DSL.inline(0)));
    }
    return sum;
  }
}
