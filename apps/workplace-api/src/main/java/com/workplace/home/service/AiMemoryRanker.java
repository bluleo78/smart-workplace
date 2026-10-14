package com.workplace.home.service;

import com.workplace.home.repository.AiMemoryRankRepository.Scored;
import com.workplace.home.repository.AiMemoryRepository.Row;
import java.time.Instant;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Stream;

/**
 * 메모리 RRF(WP-383) — 키워드 순위·의미 순위·최신 순위를 1/(K+순위) 로 더한다(K=60, 각 갈래 상위 50, 그 밖은 미스 순위 51 —
 * DriveContentSearchRepository 와 같은 상수). 최신 순위는 후보 전부에 매기되 51 이상은 51 로 묶는다(판정 8). 같은 점수는 최신 먼저.
 */
public final class AiMemoryRanker {

  public static final int K = 60;
  public static final int CANDIDATES = 50;
  public static final int MISS_RANK = CANDIDATES + 1;

  /**
   * 순위가 매겨진 행.
   *
   * @param matched 키워드나 의미 갈래 상위 50 에 들었는가 — 검색 API 는 이 행만 돌려준다(최신만으로는 "찾은 것"이 아니다)
   */
  public record Ranked(Row row, double score, boolean matched) {}

  /** updated_at 최신순, 같으면 id 큰 것 먼저(저장소 정렬과 같다). */
  public static final Comparator<Row> NEWEST =
      Comparator.comparing(Row::updatedAt, Comparator.<Instant>reverseOrder())
          .thenComparing(Row::id, Comparator.<Long>reverseOrder());

  /** 키워드: (낱말 일치 수 + 전문검색 일치) 많은 순 → ts_rank 높은 순 → 최신. */
  private static final Comparator<Scored> KEYWORD =
      Comparator.comparingInt((Scored s) -> s.termHits() + (s.ftsMatch() ? 1 : 0))
          .reversed()
          .thenComparing(Scored::ftsRank, Comparator.<Double>reverseOrder())
          .thenComparing(Scored::row, NEWEST);

  /** 의미: 코사인 거리 가까운 순 → 최신. */
  private static final Comparator<Scored> SEMANTIC =
      Comparator.comparing(Scored::distance).thenComparing(Scored::row, NEWEST);

  private AiMemoryRanker() {}

  /** 점수 높은 순(같으면 최신 먼저)으로 돌려준다. */
  public static List<Ranked> rank(List<Scored> scored) {
    Map<Long, Integer> keyword =
        topRanks(scored.stream().filter(s -> s.ftsMatch() || s.termHits() > 0).sorted(KEYWORD));
    Map<Long, Integer> semantic =
        topRanks(scored.stream().filter(s -> s.distance() != null).sorted(SEMANTIC));
    Map<Long, Integer> recent =
        topRanks(scored.stream().sorted(Comparator.comparing(Scored::row, NEWEST)));
    return scored.stream()
        .map(
            s -> {
              long id = s.row().id();
              double score = rrf(keyword.get(id)) + rrf(semantic.get(id)) + rrf(recent.get(id));
              return new Ranked(
                  s.row(), score, keyword.containsKey(id) || semantic.containsKey(id));
            })
        .sorted(
            Comparator.comparingDouble(Ranked::score).reversed().thenComparing(Ranked::row, NEWEST))
        .toList();
  }

  /** 정렬된 앞 CANDIDATES 개에 1부터 순위 — 그 밖은 맵에 없다(= 미스 순위 51). */
  private static Map<Long, Integer> topRanks(Stream<Scored> sorted) {
    Map<Long, Integer> ranks = new HashMap<>();
    sorted.limit(CANDIDATES).forEach(s -> ranks.put(s.row().id(), ranks.size() + 1));
    return ranks;
  }

  private static double rrf(Integer rank) {
    return 1.0 / (K + (rank == null ? MISS_RANK : rank));
  }
}
