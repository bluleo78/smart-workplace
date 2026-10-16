package com.workplace.home.service;

import com.workplace.home.repository.AiMemoryRankRepository.Scored;
import com.workplace.home.repository.AiMemoryRepository.Row;
import java.time.Duration;
import java.time.Instant;
import java.util.Comparator;
import java.util.List;

/**
 * 메모리 RRF(WP-383) — 키워드 순위·의미 순위·최신 순위를 1/(K+순위) 로 더한다(K=60, 각 갈래 상위 50, 그 밖은 미스 순위 51 —
 * DriveContentSearchRepository 와 같은 상수). 의미 갈래는 거리 SEMANTIC_MAX_DISTANCE 이하만 든다. 최신 순위는 후보 전부에 매기되
 * 51 이상은 51 로 묶는다(판정 8). WP-385: 최신은 사용 시각 기준이고 감쇠 행은 뺀다. 같은 점수는 최신 먼저.
 *
 * <p>WP-386: RRF 핵심은 {@link RrfRanking} 으로 빼 공용 메모리 검색과 함께 쓴다. 여기에는 개인 전용 규칙(감쇠·사용 시각 순서)만 남는다.
 */
public final class AiMemoryRanker {

  public static final int K = RrfRanking.K;
  public static final int CANDIDATES = RrfRanking.CANDIDATES;
  public static final int MISS_RANK = RrfRanking.MISS_RANK;

  /** 의미 갈래 거리 상한 — 근거와 측정값은 {@link RrfRanking#SEMANTIC_MAX_DISTANCE}. */
  public static final double SEMANTIC_MAX_DISTANCE = RrfRanking.SEMANTIC_MAX_DISTANCE;

  /**
   * 순위가 매겨진 행.
   *
   * @param matched 키워드 갈래 상위 50 이나 의미 갈래(거리 SEMANTIC_MAX_DISTANCE 이하 중 상위 50)에 들었는가 — 검색 API 는 이 행만
   *     돌려준다(최신만으로는 "찾은 것"이 아니다)
   */
  public record Ranked(Row row, double score, boolean matched) {}

  /** updated_at 최신순, 같으면 id 큰 것 먼저(저장소 정렬과 같다). */
  public static final Comparator<Row> NEWEST =
      Comparator.comparing(Row::updatedAt, Comparator.<Instant>reverseOrder())
          .thenComparing(Row::id, Comparator.<Long>reverseOrder());

  /** 감쇠 기준(WP-385) — AI 가 저장했고 고정 안 됐고 이만큼 쓰이지 않은 행은 최근 갈래·빈 질의 목록에서 뺀다. */
  public static final Duration DECAY_AFTER = Duration.ofDays(30);

  /** last_used_at 최근순, 같으면 id 큰 것 먼저(WP-385 — 최근 갈래·빈 질의 순서). 설정 목록은 그대로 NEWEST(updated_at). */
  public static final Comparator<Row> RECENTLY_USED =
      Comparator.comparing(Row::lastUsedAt, Comparator.<Instant>reverseOrder())
          .thenComparing(Row::id, Comparator.<Long>reverseOrder());

  /** 감쇠 행인가 — AI 저장 + 고정 아님 + 사용 시각이 now − 30일보다 앞. 사용자 저장분·고정분은 감쇠하지 않는다(스펙 결정 4). */
  public static boolean decayed(Row r, Instant now) {
    return "AI".equals(r.source())
        && !r.pinned()
        && r.lastUsedAt().isBefore(now.minus(DECAY_AFTER));
  }

  private AiMemoryRanker() {}

  /**
   * 점수 높은 순(같으면 최신 먼저)으로 돌려준다. 최근 갈래는 사용 시각 순이고 감쇠 행은 넣지 않는다 — 감쇠 행은 키워드·의미로 맞을 때만 점수를 얻는다(WP-385
   * 스펙 7).
   */
  public static List<Ranked> rank(List<Scored> scored, Instant now) {
    return RrfRanking.rank(
            scored,
            s -> s.row().id(),
            Comparator.comparing(Scored::row, NEWEST),
            s -> !decayed(s.row(), now),
            Comparator.comparing(Scored::row, RECENTLY_USED))
        .stream()
        .map(r -> new Ranked(r.item().row(), r.score(), r.matched()))
        .toList();
  }
}
