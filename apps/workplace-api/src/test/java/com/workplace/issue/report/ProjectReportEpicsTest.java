package com.workplace.issue.report;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.LocalDate;
import java.util.List;
import java.util.stream.IntStream;
import org.junit.jupiter.api.Test;

/** 에픽 집계 순수 규칙(WP-1629) — 제목 상한, 담당 표기, 진행 중 에픽 상태 낱말. */
class ProjectReportEpicsTest {

  private static final LocalDate TODAY = LocalDate.parse("2026-11-16");

  private static LocalDate d(String s) {
    return LocalDate.parse(s);
  }

  @Test
  void capTitles_keepsUpTo100_thenOthersLine() {
    List<String> hundred = IntStream.range(0, 100).mapToObj(i -> "t" + i).toList();
    assertThat(ProjectReportEpics.capTitles(hundred)).hasSize(100).doesNotContain("외 0건");

    List<String> many = IntStream.range(0, 130).mapToObj(i -> "t" + i).toList();
    List<String> capped = ProjectReportEpics.capTitles(many);
    assertThat(capped).hasSize(101);
    assertThat(capped.get(99)).isEqualTo("t99");
    assertThat(capped.get(100)).isEqualTo("외 30건");
  }

  @Test
  void assigneeLabel_aiWins_humansJoined_noneWhenEmpty() {
    assertThat(ProjectReportEpics.assigneeLabel(List.of("김", "이"), true)).isEqualTo("AI");
    assertThat(ProjectReportEpics.assigneeLabel(List.of("김", "이"), false))
        .isEqualTo("김(사람), 이(사람)");
    assertThat(ProjectReportEpics.assigneeLabel(List.of(), false)).isEqualTo("없음");
  }

  @Test
  void epicStatus_byProjectedVsDue() {
    // 둘 다 있으면 예상 − 기한: >3 위험, >0 주의, 그 외 순조로움.
    assertThat(ProjectReportEpics.epicStatus(d("2026-11-20"), d("2026-11-24"), true, TODAY))
        .isEqualTo("위험");
    assertThat(ProjectReportEpics.epicStatus(d("2026-11-20"), d("2026-11-23"), true, TODAY))
        .isEqualTo("주의");
    assertThat(ProjectReportEpics.epicStatus(d("2026-11-20"), d("2026-11-20"), true, TODAY))
        .isEqualTo("순조로움");
    // 예상만 있으면 순조로움.
    assertThat(ProjectReportEpics.epicStatus(null, d("2026-11-30"), true, TODAY)).isEqualTo("순조로움");
    // 예상이 없고 남은 일이 있으면 기한이 오늘보다 앞이면 위험, 아니면 주의.
    assertThat(ProjectReportEpics.epicStatus(d("2026-11-15"), null, true, TODAY)).isEqualTo("위험");
    assertThat(ProjectReportEpics.epicStatus(d("2026-11-16"), null, true, TODAY)).isEqualTo("주의");
    assertThat(ProjectReportEpics.epicStatus(null, null, true, TODAY)).isEqualTo("주의");
    // 하위가 없는 에픽은 에픽 자신이 남은 일이라 호출부가 hasRemaining=true 로 넘긴다 — 기한이 지났으면 위험(WP-1629).
    assertThat(ProjectReportEpics.epicStatus(d("2026-11-10"), null, true, TODAY)).isEqualTo("위험");
    // 남은 일이 없으면 순조로움.
    assertThat(ProjectReportEpics.epicStatus(d("2026-11-01"), null, false, TODAY))
        .isEqualTo("순조로움");
  }

  @Test
  void lateDays_andMd() {
    assertThat(ProjectReportEpics.lateDays(d("2026-11-11"), d("2026-11-14"))).isEqualTo(3);
    assertThat(ProjectReportEpics.lateDays(d("2026-11-06"), d("2026-11-03"))).isEqualTo(-3);
    assertThat(ProjectReportEpics.lateDays(null, d("2026-11-03"))).isNull();
    assertThat(ProjectReportEpics.md(d("2026-11-04"))).isEqualTo("11/4");
    assertThat(ProjectReportEpics.md(null)).isNull();
  }
}
