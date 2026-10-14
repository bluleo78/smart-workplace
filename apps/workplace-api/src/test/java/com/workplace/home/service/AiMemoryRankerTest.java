package com.workplace.home.service;

import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.home.repository.AiMemoryRankRepository.Scored;
import com.workplace.home.repository.AiMemoryRepository.Row;
import com.workplace.home.service.AiMemoryRanker.Ranked;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;

/** WP-383 RRF(키워드·의미·최신, K=60, 후보 50, 미스 51) — 스프링 없이 순위 재료만으로 확인한다. */
class AiMemoryRankerTest {

  /** id 와 "몇 초 전"으로 행을 만든다(작을수록 최신). */
  private static Row row(long id, long secondsAgo) {
    Instant t = Instant.parse("2026-10-14T00:00:00Z").minusSeconds(secondsAgo);
    return new Row(id, "PREFERENCE", "m" + id, "USER", null, t, t, null, null, false);
  }

  private static Scored plain(Row r) {
    return new Scored(r, false, 0, 0, null);
  }

  @Test
  void 키워드가_맞은_오래된_행이_최신_행보다_앞선다() {
    Row newest = row(1, 1);
    Row hit = row(2, 100);
    Row oldest = row(3, 200);

    List<Ranked> ranked =
        AiMemoryRanker.rank(
            List.of(plain(newest), new Scored(hit, false, 0, 1, null), plain(oldest)));

    assertThat(ranked).extracting(r -> r.row().id()).containsExactly(2L, 1L, 3L);
    assertThat(ranked)
        .filteredOn(Ranked::matched)
        .extracting(r -> r.row().id())
        .containsExactly(2L);
  }

  @Test
  void 의미_거리가_가까운_행이_순위를_얻고_임베딩_없는_행은_미스다() {
    Row newerNoVec = row(1, 1);
    Row olderClose = row(2, 100);

    List<Ranked> ranked =
        AiMemoryRanker.rank(List.of(plain(newerNoVec), new Scored(olderClose, false, 0, 0, 0.1)));

    assertThat(ranked.get(0).row().id()).isEqualTo(2L);
    assertThat(ranked.get(0).matched()).isTrue();
    assertThat(ranked.get(1).matched()).isFalse();
  }

  @Test
  void 의미_거리가_상한을_넘으면_맞지_않은_것이고_순위도_얻지_못한다() {
    Row newerFar = row(1, 1);
    Row olderNear = row(2, 100);
    Row oldestFar = row(3, 200);

    List<Ranked> ranked =
        AiMemoryRanker.rank(
            List.of(
                new Scored(newerFar, false, 0, 0, AiMemoryRanker.SEMANTIC_MAX_DISTANCE + 0.01),
                new Scored(olderNear, false, 0, 0, AiMemoryRanker.SEMANTIC_MAX_DISTANCE),
                new Scored(oldestFar, false, 0, 0, 1.0)));

    // 상한 밖 행은 임베딩이 있어도 의미 미스(51) — 상한 안 행만 순위를 얻어 앞서고, 검색이 돌려줄 행도 그것뿐이다.
    assertThat(ranked).extracting(r -> r.row().id()).containsExactly(2L, 1L, 3L);
    assertThat(ranked)
        .filteredOn(Ranked::matched)
        .extracting(r -> r.row().id())
        .containsExactly(2L);
  }

  @Test
  void 최신_순위는_51_이상을_51_로_묶는다() {
    List<Scored> scored = new ArrayList<>();
    for (long i = 1; i <= 60; i++) scored.add(plain(row(i, i)));

    List<Ranked> ranked = AiMemoryRanker.rank(scored);

    // 아무 재료도 맞지 않으면 최신순 그대로이고, 51번째부터는 점수가 같다(판정 8).
    assertThat(ranked).extracting(r -> r.row().id()).isSorted();
    assertThat(ranked.get(50).score()).isEqualTo(ranked.get(59).score());
    assertThat(ranked.get(0).score()).isGreaterThan(ranked.get(50).score());
    assertThat(ranked).noneMatch(Ranked::matched);
  }
}
