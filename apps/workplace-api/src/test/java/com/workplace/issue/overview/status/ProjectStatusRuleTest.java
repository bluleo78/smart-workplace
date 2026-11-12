package com.workplace.issue.overview.status;

import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.issue.overview.ProjectOverviewResponse.Epics;
import com.workplace.issue.overview.ProjectOverviewResponse.Progress;
import com.workplace.issue.overview.ProjectOverviewResponse.Target;
import java.time.LocalDate;
import java.util.List;
import org.junit.jupiter.api.Test;

/**
 * 상태 배지 규칙(WP-1479) 경계 — 늦은 일수 0·1·3·4일, 예상이 없을 때(기간 끝남 → 위험, 끝나기 전 → 주의, 다 끝남 → 순조로움), 종료일 없이 예상만
 * 있을 때(순조로움), 전체 추이.
 */
class ProjectStatusRuleTest {

  private static final Epics NO_EPICS = new Epics(null, 0, 0, List.of());

  /** 사이클 종료일. */
  private static final LocalDate END = LocalDate.parse("2026-11-14");

  /** 종료 전 오늘(서울). */
  private static final LocalDate BEFORE_END = LocalDate.parse("2026-11-11");

  /** 사이클 진행 중 위젯 — 범위 10건 중 done 건 완료, 늦은 일수만 바꿔 본다. */
  private static Progress cycle(int done, Integer lateDays) {
    return scoped("CYCLE", END, done, lateDays);
  }

  /** 사이클·버전 진행 중 위젯 — 범위 10건. */
  private static Progress scoped(String kind, LocalDate end, int done, Integer lateDays) {
    return new Progress(
        kind,
        new Target(1L, "11월 2주", END.minusDays(13), end),
        10,
        done,
        List.of(),
        lateDays == null || end == null ? null : end.plusDays(lateDays),
        lateDays,
        null,
        NO_EPICS);
  }

  @Test
  void lateDaysBoundaries() {
    assertThat(ProjectStatusRule.badge(cycle(5, -2), BEFORE_END)).isEqualTo(StatusBadge.ON_TRACK);
    assertThat(ProjectStatusRule.badge(cycle(5, 0), BEFORE_END)).isEqualTo(StatusBadge.ON_TRACK);
    assertThat(ProjectStatusRule.badge(cycle(5, 1), BEFORE_END)).isEqualTo(StatusBadge.WARN);
    assertThat(ProjectStatusRule.badge(cycle(5, 3), BEFORE_END)).isEqualTo(StatusBadge.WARN);
    assertThat(ProjectStatusRule.badge(cycle(5, 4), BEFORE_END)).isEqualTo(StatusBadge.RISK);
  }

  @Test
  void noProjectionAfterEndWithRemainingIsRisk() {
    // 기간이 끝났는데 남은 일이 있고 최근 완료가 없어 예상도 없다 — 멈춘 사이클.
    assertThat(ProjectStatusRule.badge(cycle(5, null), END.plusDays(1)))
        .isEqualTo(StatusBadge.RISK);
    assertThat(ProjectStatusRule.badge(scoped("VERSION", END, 5, null), END.plusDays(1)))
        .isEqualTo(StatusBadge.RISK);
  }

  @Test
  void noProjectionBeforeEndIsWarn() {
    // 최근 완료가 없어 예상할 수 없다 — 종료일 당일도 아직 지나지 않았다.
    assertThat(ProjectStatusRule.badge(cycle(5, null), BEFORE_END)).isEqualTo(StatusBadge.WARN);
    assertThat(ProjectStatusRule.badge(cycle(5, null), END)).isEqualTo(StatusBadge.WARN);
    // 종료일이 없는 범위도 주의.
    assertThat(ProjectStatusRule.badge(scoped("VERSION", null, 0, null), END.plusDays(30)))
        .isEqualTo(StatusBadge.WARN);
  }

  @Test
  void noEndWithProjectionIsOnTrack() {
    // 끝 날짜가 없는 버전·사이클 — 예상 완료일은 있지만 비교할 종료일이 없어 늦은 일수가 없다. 예상이 서므로(최근 완료가 있음) 순조로움.
    Progress noEndVersion =
        new Progress(
            "VERSION",
            new Target(1L, "v2", END.minusDays(13), null),
            10,
            5,
            List.of(),
            END.plusDays(20),
            null,
            null,
            NO_EPICS);
    assertThat(ProjectStatusRule.badge(noEndVersion, BEFORE_END)).isEqualTo(StatusBadge.ON_TRACK);
    Progress noEndCycle =
        new Progress(
            "CYCLE",
            new Target(1L, "끝 없음", END.minusDays(13), null),
            10,
            5,
            List.of(),
            END.plusDays(20),
            null,
            null,
            NO_EPICS);
    assertThat(ProjectStatusRule.badge(noEndCycle, END.plusDays(30)))
        .isEqualTo(StatusBadge.ON_TRACK);
  }

  @Test
  void allDoneIsOnTrack() {
    assertThat(ProjectStatusRule.badge(cycle(10, null), END.plusDays(5)))
        .isEqualTo(StatusBadge.ON_TRACK);
    assertThat(ProjectStatusRule.badge(cycle(10, null), BEFORE_END))
        .isEqualTo(StatusBadge.ON_TRACK);
    // 다 끝났으면 늦게 끝났어도(예상 = 오늘 > 종료일) 순조로움.
    assertThat(ProjectStatusRule.badge(cycle(10, 5), END.plusDays(5)))
        .isEqualTo(StatusBadge.ON_TRACK);
  }

  @Test
  void emptyScopeIsOnTrack() {
    Progress empty =
        new Progress(
            "CYCLE",
            new Target(1L, "빈 사이클", END.minusDays(13), END),
            0,
            0,
            List.of(),
            null,
            null,
            null,
            NO_EPICS);
    assertThat(ProjectStatusRule.badge(empty, END.plusDays(3))).isEqualTo(StatusBadge.ON_TRACK);
  }

  @Test
  void trendIsOnTrack() {
    Progress trend = new Progress("TREND", null, 7, null, List.of(), null, null, 3, NO_EPICS);
    assertThat(ProjectStatusRule.badge(trend, END.plusDays(30))).isEqualTo(StatusBadge.ON_TRACK);
  }
}
