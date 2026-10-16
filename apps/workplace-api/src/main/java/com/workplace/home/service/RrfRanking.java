package com.workplace.home.service;

import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Predicate;
import java.util.function.ToLongFunction;
import java.util.stream.Stream;

/**
 * 키워드·의미·최신 RRF 의 행 타입과 무관한 핵심(WP-383 → WP-386 에서 공용화). 개인 메모리({@link AiMemoryRanker})와 공용 메모리
 * (SharedAiMemoryService)가 같은 규칙으로 순위를 매기게 한 곳에 둔다 — 1/(K+순위), K=60, 각 갈래 상위 50, 그 밖은 미스 순위 51. 의미
 * 갈래는 거리 {@link #SEMANTIC_MAX_DISTANCE} 이하만 든다. 개인 전용 규칙(감쇠·사용 시각 순서)은 호출자가 "최근 갈래에 들 행"과 "그 순서"로
 * 넘긴다.
 */
public final class RrfRanking {

  public static final int K = 60;
  public static final int CANDIDATES = 50;
  public static final int MISS_RANK = CANDIDATES + 1;

  /**
   * 의미 갈래에 "맞았다"고 보는 코사인 거리 상한(이하만 의미 순위에 든다). 상위 50 만으로 거르면 임베딩된 행은 질의와 무관해도 늘 들어 검색이 거르지 못한다 —
   * 그래서 거리로 자른다. 메모리 검색(matched)·채팅 주입 순위가 쓴다(지난 대화 검색은 별도 상수). 실제 BGE-M3 측정(짧은 문장): 관련 쌍 최대 0.429,
   * 무관 쌍 최소 0.329·하위 5% 0.462. 0.45 는 관련 13/13 을 유지하고 무관 23/707 만 들이며(0.50 은 74/707) 이 값으로 정했다.
   */
  public static final double SEMANTIC_MAX_DISTANCE = 0.45;

  /** 한 행의 순위 재료 — 개인·공용 Scored 레코드가 구현한다(레코드 구성요소가 그대로 접근자). */
  public interface Material {
    /** search_tv @@ websearch_to_tsquery('simple', 질의). */
    boolean ftsMatch();

    /** ts_rank(일치하지 않으면 0). */
    double ftsRank();

    /** 질의 낱말 중 내용에 부분 일치한 수. */
    int termHits();

    /** 질의 임베딩과의 코사인 거리 — 없으면 null(의미 미스). */
    Double distance();
  }

  /**
   * 순위가 매겨진 행.
   *
   * @param matched 키워드 갈래 상위 50 이나 의미 갈래(거리 상한 이하 중 상위 50)에 들었는가 — 검색은 이 행만 돌려준다(최신만으로는 "찾은 것"이
   *     아니다)
   */
  public record Ranked<S>(S item, double score, boolean matched) {}

  private RrfRanking() {}

  /**
   * 점수 높은 순(같으면 newest 순)으로 돌려준다.
   *
   * @param id 행 id(갈래별 순위 맵의 키)
   * @param newest 같은 점수·같은 갈래 안의 동률을 가르는 "최신 먼저" 순서
   * @param inRecent 최근 갈래에 넣을 행(개인은 감쇠 행을 뺀다) — 공용은 전부
   * @param recentOrder 최근 갈래 순서(개인은 사용 시각, 공용은 수정 시각)
   */
  public static <S extends Material> List<Ranked<S>> rank(
      List<S> scored,
      ToLongFunction<S> id,
      Comparator<S> newest,
      Predicate<S> inRecent,
      Comparator<S> recentOrder) {
    // 키워드: (낱말 일치 수 + 전문검색 일치) 많은 순 → ts_rank 높은 순 → 최신.
    Comparator<S> keywordOrder =
        Comparator.<S>comparingInt(s -> s.termHits() + (s.ftsMatch() ? 1 : 0))
            .reversed()
            .thenComparing(Comparator.<S, Double>comparing(S::ftsRank).reversed())
            .thenComparing(newest);
    // 의미: 코사인 거리 가까운 순 → 최신(거리 상한 안의 행만 이 정렬에 들어온다).
    Comparator<S> semanticOrder =
        Comparator.<S, Double>comparing(S::distance).thenComparing(newest);

    Map<Long, Integer> keyword =
        topRanks(scored.stream().filter(RrfRanking::keywordHit).sorted(keywordOrder), id);
    Map<Long, Integer> semantic =
        topRanks(scored.stream().filter(RrfRanking::semanticHit).sorted(semanticOrder), id);
    Map<Long, Integer> recent = topRanks(scored.stream().filter(inRecent).sorted(recentOrder), id);
    return scored.stream()
        .map(
            s -> {
              long key = id.applyAsLong(s);
              double score = rrf(keyword.get(key)) + rrf(semantic.get(key)) + rrf(recent.get(key));
              return new Ranked<>(s, score, keyword.containsKey(key) || semantic.containsKey(key));
            })
        .sorted(
            Comparator.<Ranked<S>>comparingDouble(Ranked::score)
                .reversed()
                .thenComparing(Ranked::item, newest))
        .toList();
  }

  /** 키워드 갈래에 들 수 있는가 — 전문검색 일치이거나 낱말이 하나라도 부분 일치. */
  private static boolean keywordHit(Material s) {
    return s.ftsMatch() || s.termHits() > 0;
  }

  /** 질의 임베딩과 행 임베딩이 모두 있고 거리가 상한 이하인가 — 아니면 의미 미스(순위 51). */
  private static boolean semanticHit(Material s) {
    return s.distance() != null && s.distance() <= SEMANTIC_MAX_DISTANCE;
  }

  /** 정렬된 앞 CANDIDATES 개에 1부터 순위 — 그 밖은 맵에 없다(= 미스 순위 51). */
  private static <S> Map<Long, Integer> topRanks(Stream<S> sorted, ToLongFunction<S> id) {
    Map<Long, Integer> ranks = new HashMap<>();
    sorted.limit(CANDIDATES).forEach(s -> ranks.put(id.applyAsLong(s), ranks.size() + 1));
    return ranks;
  }

  private static double rrf(Integer rank) {
    return 1.0 / (K + (rank == null ? MISS_RANK : rank));
  }
}
