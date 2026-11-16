package com.workplace.wiki.report;

import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.issue.report.ReportCadence;
import com.workplace.wiki.report.ReportScheduleChart.ChartRow;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.Test;

/**
 * 일정 도표(WP-1629) — 기한을 정한 완료 에픽으로 html-embed SVG 블록을 만든다. 기한 없는 에픽은 빠지고, 지연은 주황·「+N일」 라벨, 툴팁은 SVG
 * {@code <title>}, 스크립트·CSS 변수 없음, 제목은 XML 이스케이프. 순수 단위 테스트.
 */
class ReportScheduleChartTest {

  /** spike 이번 주 — 기한 없는 WP-1503 포함. */
  static final List<ChartRow> CURRENT =
      List.of(
          new ChartRow("AI 에이전트 직접 실행 지원", "11/6", "11/9", 3),
          new ChartRow("AI 계정 관리와 사용량 모니터링", "11/11", "11/14", 3),
          new ChartRow("프로젝트·개인 성과 지표와 AI 리포트", "11/13", "11/14", 1),
          new ChartRow("도움말 기능 강화", null, "11/14", null));

  /** spike 지난주. */
  static final List<ChartRow> PREVIOUS =
      List.of(
          new ChartRow("외부 AI 에이전트 연동 개선", "10/30", "11/2", 3),
          new ChartRow("통합 검색 개선", "11/6", "11/6", 0),
          new ChartRow("반복 AI 작업 만들기·실행 개선", "11/6", "11/3", -3),
          new ChartRow("노트 HTML 문서 작성·편집 지원", "11/6", "11/3", -3));

  private static int count(String s, String part) {
    return s.split(java.util.regex.Pattern.quote(part), -1).length - 1;
  }

  @Test
  void block_spikeData_rendersSelfContainedSvg() {
    String block = ReportScheduleChart.block(CURRENT, PREVIOUS, ReportCadence.WEEKLY).orElseThrow();

    assertThat(block).startsWith("```html-embed\n").endsWith("\n```");
    assertThat(count(block, "<svg")).isEqualTo(1);
    // 기한 없는 「도움말 기능 강화」는 행이 없다 — 행마다 툴팁 하나.
    assertThat(count(block, "<title>")).isEqualTo(7);
    assertThat(block).doesNotContain("도움말 기능 강화");
    assertThat(block).doesNotContain("<script").doesNotContain("var(--");
    assertThat(count(block, "+3일")).isEqualTo(3);
    assertThat(block).contains("#c2410c").contains("#6b7280").contains("#e5e7eb");
    assertThat(block).contains("완료일 − 기한");
    assertThat(block).contains("기한을 정한 에픽 · 위 3개 이번 주, 아래 4개 지난주");
    assertThat(block).contains("3일 앞당김").contains("기한일").contains("3일 지연");
    assertThat(block)
        .contains("<title>AI 계정 관리와 사용량 모니터링 — 기한 11/11, 완료 11/14, 3일 지연</title>")
        .contains("<title>통합 검색 개선 — 기한 11/6, 완료 11/6, 기한일 완료</title>")
        .contains("<title>노트 HTML 문서 작성·편집 지원 — 기한 11/6, 완료 11/3, 3일 앞당김</title>");
    // 18자 넘는 제목은 17자 + 말줄임(18자 딱 맞으면 그대로).
    assertThat(block).contains(">프로젝트·개인 성과 지표와 AI…<");
    assertThat(block).contains(">AI 계정 관리와 사용량 모니터링<");
    assertThat(block).contains("width=\"100%\"").contains("viewBox=\"0 0 640 ");
  }

  @Test
  void block_escapesTitles() {
    List<ChartRow> rows = List.of(new ChartRow("<b>A&B</b> \"q\" 'x'", "11/6", "11/7", 1));

    String block = ReportScheduleChart.block(rows, List.of(), ReportCadence.WEEKLY).orElseThrow();

    assertThat(block).doesNotContain("<b>").doesNotContain("A&B");
    assertThat(block).contains("&lt;b&gt;A&amp;B&lt;/b&gt; &quot;q&quot; &#39;x&#39;");
    // 지난주 행이 없으면 그쪽 문구를 뺀다.
    assertThat(block).contains("기한을 정한 에픽 · 1개 이번 주<").doesNotContain("지난주");
  }

  @Test
  void block_noRowsWithDue_empty() {
    List<ChartRow> rows = List.of(new ChartRow("기한 없음", null, "11/14", null));

    assertThat(ReportScheduleChart.block(rows, List.of(), ReportCadence.WEEKLY))
        .isEqualTo(Optional.empty());
    assertThat(ReportScheduleChart.block(List.of(), List.of(), ReportCadence.WEEKLY)).isEmpty();
  }

  private static List<ChartRow> rows(String prefix, int n) {
    java.util.ArrayList<ChartRow> list = new java.util.ArrayList<>();
    for (int i = 1; i <= n; i++) list.add(new ChartRow(prefix + i, "11/6", "11/7", 1));
    return list;
  }

  private static int height(String block) {
    var m = java.util.regex.Pattern.compile("viewBox=\"0 0 640 (\\d+)\"").matcher(block);
    assertThat(m.find()).isTrue();
    return Integer.parseInt(m.group(1));
  }

  /** 12행 — 행 높이를 줄여 400 이하, 12개 툴팁이 모두 남는다. */
  @Test
  void block_manyRows_shrinksRowHeightToFit() {
    String block =
        ReportScheduleChart.block(rows("현재", 6), rows("지난", 6), ReportCadence.MONTHLY)
            .orElseThrow();

    assertThat(height(block)).isLessThanOrEqualTo(400);
    assertThat(count(block, "<title>")).isEqualTo(12);
    assertThat(block).doesNotContain("외 ");
  }

  /** 25행 — 지난 기간의 오래된 행부터 덜어내고 부제에 「외 N개」. */
  @Test
  void block_tooManyRows_dropsOldestPreviousFirst() {
    String block =
        ReportScheduleChart.block(rows("현재", 10), rows("지난", 15), ReportCadence.WEEKLY)
            .orElseThrow();

    assertThat(height(block)).isLessThanOrEqualTo(400);
    // 한도 16행 → 9개 덜어냄: 지난 1~9 가 빠지고 지난 10~15 와 현재 10개가 남는다.
    assertThat(block).contains("외 9개");
    assertThat(count(block, "<title>")).isEqualTo(16);
    assertThat(block).doesNotContain("지난1 —").doesNotContain("지난9 —");
    assertThat(block).contains("지난10 —").contains("현재1 —");
  }

  /** 이번 기간만 넘치면 이번 기간의 오래된 행도 덜어낸다. */
  @Test
  void block_onlyCurrentTooMany_dropsOldestCurrent() {
    String block =
        ReportScheduleChart.block(rows("현재", 20), List.of(), ReportCadence.WEEKLY).orElseThrow();

    assertThat(height(block)).isLessThanOrEqualTo(400);
    assertThat(block).contains("외 4개").doesNotContain("현재4 —").contains("현재5 —");
  }

  @Test
  void block_cadenceWords() {
    String monthly =
        ReportScheduleChart.block(CURRENT, PREVIOUS, ReportCadence.MONTHLY).orElseThrow();
    assertThat(monthly).contains("위 3개 이번 달, 아래 4개 지난달");
    String biweekly =
        ReportScheduleChart.block(CURRENT, PREVIOUS, ReportCadence.BIWEEKLY).orElseThrow();
    assertThat(biweekly).contains("위 3개 이번 기간, 아래 4개 지난 기간");
  }

  /** 축 범위는 ±max(3, 가장 큰 |lateDays|) — 큰 지연이면 눈금 라벨이 그 값. */
  @Test
  void block_axisRangeFollowsLargestLate() {
    List<ChartRow> rows = List.of(new ChartRow("크게 늦음", "11/1", "11/11", 10));

    String block = ReportScheduleChart.block(rows, List.of(), ReportCadence.WEEKLY).orElseThrow();

    assertThat(block).contains("10일 앞당김").contains("10일 지연").contains("+10일");
  }
}
