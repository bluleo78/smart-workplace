package com.workplace.wiki.report;

import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.issue.overview.status.StatusBadge;
import com.workplace.issue.report.ProjectReportFacts;
import com.workplace.issue.report.ReportCadence;
import com.workplace.issue.report.ReportPeriod;
import com.workplace.issue.report.ReportSnapshot;
import com.workplace.issue.report.ReportTableRow;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

/**
 * 리포트 마크다운 후처리(WP-1483) — 지시 상자 제거, 맨 앞 h1 제거, 「지난 리포트 이후」 표를 계산값으로 다시 쓰기(펜스 안 표 무시·머리 접두 인식), 배지 줄
 * 바로잡기, 앱 이슈 링크를 맨 주소로, 카드용 한 줄 읽기를 고정한다. 순수 단위 테스트.
 */
class ReportMarkdownTest {

  private static final String BASE = "https://works.example.com";
  private static final String PREFIX = BASE + "/projects/";

  private static final List<ReportTableRow> ROWS =
      List.of(
          new ReportTableRow("완료", "2", "+1"),
          new ReportTableRow("새로 생김", "3", "−1"),
          new ReportTableRow("열린 이슈", "10", "—"),
          new ReportTableRow("기한 지남", "1", "0"));

  private static ProjectReportFacts facts(StatusBadge badge, StatusBadge previous) {
    ReportPeriod period =
        new ReportPeriod(
            LocalDate.parse("2026-11-09"), LocalDate.parse("2026-11-15"), ReportCadence.WEEKLY);
    return new ProjectReportFacts(
        period,
        badge,
        previous,
        ROWS,
        new ReportSnapshot(2, 3, 10, 1, badge.name()),
        List.of(),
        Map.of(),
        false);
  }

  private static ProjectReportFacts facts() {
    return facts(StatusBadge.ON_TRACK, StatusBadge.ON_TRACK);
  }

  private static final String SYSTEM_BODY =
      """
      | 완료 | 2 | +1 |
      | 새로 생김 | 3 | −1 |
      | 열린 이슈 | 10 | — |
      | 기한 지남 | 1 | 0 |""";

  private static String finish(String md, boolean templateHasTable) {
    return ReportMarkdown.finish(md, facts(), templateHasTable, PREFIX);
  }

  @Test
  void finish_stripsInstructionBoxes() {
    String md =
        """
        ## 상태와 한 줄

        <div class="wp-ai-instruction">

        지시입니다

        </div>

        **순조로움**

        잘 되고 있어요.
        """;

    String out = finish(md, false);

    assertThat(out).doesNotContain("wp-ai-instruction").doesNotContain("지시입니다");
    assertThat(out).contains("잘 되고 있어요.");
  }

  @Test
  void finish_removesLeadingH1() {
    String md =
        """
        # 11월 3주차 주간 리포트

        ## 상태와 한 줄

        **순조로움**

        본문
        """;

    String out = finish(md, false);

    assertThat(out).doesNotContain("# 11월 3주차");
    assertThat(out).startsWith("## 상태와 한 줄");
  }

  @Test
  void fixTable_overwritesWrongNumbers() {
    String md =
        """
        ## 지난 리포트 이후

        | 지난 리포트 이후 | 이번 | 변화 |
        |---|---|---|
        | 완료 | 999 | +500 |
        | 새로 생김 | 3 | −1 |
        | 열린 이슈 | 10 | — |
        | 기한 지남 | 1 | 0 |

        ## 한 일
        """;

    String out = finish(md, true);

    assertThat(out).doesNotContain("999").doesNotContain("+500");
    assertThat(out).contains("| 지난 리포트 이후 | 이번 | 변화 |\n|---|---|---|\n" + SYSTEM_BODY);
    assertThat(out).contains("## 한 일");
  }

  @Test
  void fixTable_readdsMissingRow_dropsUnknownRow() {
    String md =
        """
        | 지난 리포트 이후 | 이번 | 변화 |
        |---|---|---|
        | 완료 | 2 | +1 |
        | 리뷰 대기 | 7 | +2 |

        끝
        """;

    String out = finish(md, true);

    assertThat(out).doesNotContain("리뷰 대기");
    assertThat(out).contains(SYSTEM_BODY);
  }

  @Test
  void fixTable_insertsTable_whenTemplateHadIt() {
    String md =
        """
        ## 상태와 한 줄

        **순조로움**

        잘 되고 있어요.

        ## 한 일

        - 무엇
        """;

    String out = finish(md, true);

    int status = out.indexOf("## 상태와 한 줄");
    int table = out.indexOf("## 지난 리포트 이후");
    int done = out.indexOf("## 한 일");
    assertThat(table).isGreaterThan(status).isLessThan(done);
    assertThat(out).contains("| 지난 리포트 이후 | 이번 | 변화 |\n|---|---|---|\n" + SYSTEM_BODY);
    assertThat(ReportMarkdown.hasReportTable(out)).isTrue();
  }

  @Test
  void fixTable_noInsert_whenTemplateLacked() {
    String md =
        """
        ## 상태와 한 줄

        **순조로움**

        잘 되고 있어요.
        """;

    String out = finish(md, false);

    assertThat(out).doesNotContain("지난 리포트 이후");
    assertThat(ReportMarkdown.hasReportTable(out)).isFalse();
  }

  @Test
  void fixTable_ignoresFencedTable() {
    String fenced =
        """
        ```
        | 지난 리포트 이후 | 이번 | 변화 |
        |---|---|---|
        | 완료 | 999 | +500 |
        ```
        """;
    String md = "## 상태와 한 줄\n\n**순조로움**\n\n글\n\n## 한 일\n\n" + fenced;

    assertThat(ReportMarkdown.hasReportTable(md)).isFalse();

    String out = finish(md, true);

    // 펜스 안 예시는 손대지 않고, 진짜 표는 따로 넣는다.
    assertThat(out).contains("| 완료 | 999 | +500 |");
    assertThat(out).contains(SYSTEM_BODY);
    assertThat(out.indexOf(SYSTEM_BODY)).isLessThan(out.indexOf("```"));
  }

  @Test
  void fixTable_acceptsHeaderPrefix() {
    String md =
        """
        | **지난 리포트 이후 변화** | 이번 | 변화 |
        |:---|---:|---:|
        | 완료 | 999 | +500 |
        """;

    assertThat(ReportMarkdown.hasReportTable(md)).isTrue();

    String out = finish(md, true);

    assertThat(out).contains("| **지난 리포트 이후 변화** | 이번 | 변화 |\n|:---|---:|---:|\n" + SYSTEM_BODY);
    assertThat(out).doesNotContain("999");
  }

  /** 표 칸 값의 「|」(예: 버전 이름)는 이스케이프해 행이 깨지지 않게 한다(최종 리뷰 #6). */
  @Test
  void fixTable_escapesPipeInCells() {
    ReportPeriod period =
        new ReportPeriod(
            LocalDate.parse("2026-11-09"), LocalDate.parse("2026-11-15"), ReportCadence.WEEKLY);
    ProjectReportFacts f =
        new ProjectReportFacts(
            period,
            StatusBadge.ON_TRACK,
            null,
            List.of(new ReportTableRow("v1|베타 (11/20)", "3|4", "+1")),
            new ReportSnapshot(0, 0, 0, 0, "ON_TRACK"),
            List.of(),
            Map.of(),
            false);

    String out = ReportMarkdown.finish("## 상태와 한 줄\n\n**순조로움**\n", f, true, PREFIX);

    assertThat(out).contains("| v1\\|베타 (11/20) | 3\\|4 | +1 |");
  }

  @Test
  void fixTable_otherTablesUntouched() {
    String md =
        """
        | 이름 | 값 |
        |---|---|
        | 완료 | 999 |
        """;

    String out = finish(md, false);

    assertThat(out).contains("| 완료 | 999 |");
  }

  @Test
  void fixBadge_replacesWrongBadge() {
    String md =
        """
        ## 상태와 한 줄

        **순조로움**

        검토가 밀렸어요.
        """;

    String out =
        ReportMarkdown.finish(md, facts(StatusBadge.WARN, StatusBadge.ON_TRACK), false, PREFIX);

    assertThat(out).contains("## 상태와 한 줄\n\n**주의** · 순조로움 → 주의\n\n검토가 밀렸어요.");
  }

  @Test
  void fixBadge_noArrowWhenUnchanged() {
    String md =
        """
        ## 상태와 한 줄

        **위험** · 순조로움 → 위험

        글
        """;

    String out =
        ReportMarkdown.finish(md, facts(StatusBadge.WARN, StatusBadge.WARN), false, PREFIX);

    assertThat(out).contains("## 상태와 한 줄\n\n**주의**\n\n글");
    assertThat(out).doesNotContain("→");
  }

  @Test
  void fixBadge_insertsWhenMissing() {
    String md = "## 상태와 한 줄\n\n그냥 글\n";

    String out = ReportMarkdown.finish(md, facts(StatusBadge.RISK, null), false, PREFIX);

    assertThat(out).contains("## 상태와 한 줄\n\n**위험**\n\n그냥 글");
  }

  @Test
  void fixBadge_insertsAtTopWhenNoSection() {
    String out = ReportMarkdown.finish("글만 있음\n", facts(StatusBadge.RISK, null), false, PREFIX);

    assertThat(out).startsWith("**위험**\n\n글만 있음");
  }

  /** 「상태:」 접두 뒤 굵은 배지 — 둘째 배지 줄을 넣지 않고 그 줄을 시스템 배지 줄로 바꾼다(뒤 글은 남김, 코드 리뷰 #5). */
  @Test
  void fixBadge_replacesPrefixedBadgeLine() {
    String md =
        """
        ## 상태와 한 줄

        상태: **주의** · 순조로움 → 주의 · 검토가 밀렸어요.

        글
        """;

    String out = ReportMarkdown.finish(md, facts(StatusBadge.RISK, null), false, PREFIX);

    assertThat(out).contains("## 상태와 한 줄\n\n**위험** · 검토가 밀렸어요.\n\n글");
    assertThat(out).doesNotContain("**주의**").doesNotContain("상태:");
  }

  /** 굵게 안에 접두가 든 배지(**상태: 주의**)도 배지 줄로 보고 바꾼다(코드 리뷰 #5). */
  @Test
  void fixBadge_replacesBoldPrefixedBadge() {
    String md =
        """
        ## 상태와 한 줄

        **상태: 주의**

        글
        """;

    String out =
        ReportMarkdown.finish(md, facts(StatusBadge.RISK, StatusBadge.WARN), false, PREFIX);

    assertThat(out).contains("## 상태와 한 줄\n\n**위험** · 주의 → 위험\n\n글");
    assertThat(out).doesNotContain("상태: 주의");
  }

  /** 첫 문단 둘째 줄(소프트 줄바꿈)에 있는 굵은 배지도 그 줄을 바꾼다 — 배지 줄이 둘 생기지 않는다. */
  @Test
  void fixBadge_replacesBadgeInsideFirstParagraph() {
    String md = "## 상태와 한 줄\n\n이번 주 상태\n**주의**\n\n글\n";

    String out = ReportMarkdown.finish(md, facts(StatusBadge.RISK, null), false, PREFIX);

    assertThat(out).contains("이번 주 상태\n**위험**\n\n글");
    assertThat(out.split("\\*\\*위험\\*\\*", -1)).hasSize(2);
  }

  @Test
  void links_namedIssueLinkBecomesBareUrl() {
    String md = "## 한 일\n\n- 노트 에픽 완료 — [WP-1299](" + BASE + "/projects/WP/issues/1299) 하위 11건\n";

    String out = finish(md, false);

    assertThat(out).contains("- 노트 에픽 완료 — " + BASE + "/projects/WP/issues/1299 하위 11건");
    assertThat(out).doesNotContain("[WP-1299]");
  }

  /** 맨 주소 바로 뒤에 한글이 붙으면 주소 칩이 글자를 삼키지 않게 한 칸 띄운다. 공백·문장부호가 뒤따르면 그대로(최종 리뷰 #5). */
  @Test
  void links_insertsSpaceWhenTextFollowsBareUrl() {
    String url = BASE + "/projects/WP/issues/12";
    String md = "- [WP-12](" + url + ")에서 고쳤어요. [WP-12](" + url + "), [WP-12](" + url + ")\n";

    String out = finish(md, false);

    assertThat(out).contains("- " + url + " 에서 고쳤어요. " + url + ", " + url + "\n");
  }

  @Test
  void links_otherLinksUntouched() {
    String md =
        "[문서](https://other.example.com/projects/WP/issues/1)"
            + " [노트]("
            + BASE
            + "/wiki/pages/3)"
            + " ![그림]("
            + BASE
            + "/projects/WP/issues/2)\n"
            + "```\n[코드]("
            + BASE
            + "/projects/WP/issues/4)\n```\n";

    String out = finish(md, false);

    assertThat(out).contains("[문서](https://other.example.com/projects/WP/issues/1)");
    assertThat(out).contains("[노트](" + BASE + "/wiki/pages/3)");
    assertThat(out).contains("![그림](" + BASE + "/projects/WP/issues/2)");
    assertThat(out).contains("[코드](" + BASE + "/projects/WP/issues/4)");
  }

  @Test
  void cardSummary_readsBadgeAndFirstLine() {
    String md =
        """
        ## 상태와 한 줄

        **주의** · 순조로움 → 주의

        검토 대기가 **늘어** [WP-1](https://x/y) 일정이
        밀렸어요.

        ## 한 일
        """;

    ReportMarkdown.CardSummary s = ReportMarkdown.cardSummary(md);

    assertThat(s.badge()).isEqualTo("WARN");
    assertThat(s.line()).isEqualTo("검토 대기가 늘어 WP-1 일정이 밀렸어요.");
  }

  /** 배지 줄 같은 줄에 글이 이어지면 그 글(배지·화살표 뺀)을 한 줄로 — 다음 문단이 아니라(코드 리뷰 #6). */
  @Test
  void cardSummary_textOnBadgeLine() {
    String md =
        """
        ## 상태와 한 줄

        **주의** · 순조로움 → 주의 — 검토 대기가 늘었어요.

        다음 문단.
        """;

    ReportMarkdown.CardSummary s = ReportMarkdown.cardSummary(md);

    assertThat(s.badge()).isEqualTo("WARN");
    assertThat(s.line()).isEqualTo("검토 대기가 늘었어요.");
  }

  /** 배지 문단에 소프트 줄바꿈으로 이어진 글이 있으면 그 글을 한 줄로(코드 리뷰 #6). */
  @Test
  void cardSummary_softWrappedTextInBadgeParagraph() {
    String md = "## 상태와 한 줄\n\n상태: **위험**\n일정이 크게\n밀렸어요.\n\n다음 문단.\n";

    ReportMarkdown.CardSummary s = ReportMarkdown.cardSummary(md);

    assertThat(s.badge()).isEqualTo("RISK");
    assertThat(s.line()).isEqualTo("일정이 크게 밀렸어요.");
  }

  @Test
  void cardSummary_noSection_firstParagraph() {
    String md =
        """
        # 제목

        | a | b |
        |---|---|

        첫 문단입니다.

        두 번째.
        """;

    ReportMarkdown.CardSummary s = ReportMarkdown.cardSummary(md);

    assertThat(s.badge()).isNull();
    assertThat(s.line()).isEqualTo("첫 문단입니다.");
  }

  @Test
  void cardSummary_truncatesTo200() {
    String md = "## 상태와 한 줄\n\n**위험**\n\n" + "가".repeat(300) + "\n";

    ReportMarkdown.CardSummary s = ReportMarkdown.cardSummary(md);

    assertThat(s.badge()).isEqualTo("RISK");
    assertThat(s.line()).hasSize(200).endsWith("…");
  }

  // ───────────── 공유 단위(WP-1486) — clean / fixTable(ReportTableSpec) ─────────────

  /** 개인 일일 「어제 숫자」 같은 가로 표 스펙 — 머리까지 시스템 값으로 다시 쓴다. */
  private static ReportTableSpec dailyLikeSpec() {
    return new ReportTableSpec(
        "끝냄"::equals,
        List.of("끝냄", "새로 만듦", "상태 바꿈", "기한 지남"),
        List.of(List.of("4 · 기한 내 3", "1", "6", "2")),
        "어제 숫자",
        "한 줄");
  }

  /** 줄 목록으로 나눈다(수정 가능한 목록 — fixTable 이 고친다). */
  private static List<String> lines(String md) {
    return new java.util.ArrayList<>(List.of(md.split("\n", -1)));
  }

  @Test
  void fixTable_headCellsSpec_rewritesHeadDelimiterAndBody() {
    List<String> lines = lines("| 끝냄 | 리뷰 |\n|---|---|\n| 9 | 9 |");

    ReportMarkdown.fixTable(lines, dailyLikeSpec(), true);

    assertThat(lines)
        .containsExactly(
            "| 끝냄 | 새로 만듦 | 상태 바꿈 | 기한 지남 |", "|---|---|---|---|", "| 4 · 기한 내 3 | 1 | 6 | 2 |");
  }

  @Test
  void fixTable_missingTable_insertsAfterNamedSection() {
    List<String> lines = lines("## 한 줄\n글\n\n## 어제 한 일\n- 했음");

    ReportMarkdown.fixTable(lines, dailyLikeSpec(), true);

    assertThat(ReportMarkdown.render(lines))
        .isEqualTo(
            """
            ## 한 줄
            글

            ## 어제 숫자

            | 끝냄 | 새로 만듦 | 상태 바꿈 | 기한 지남 |
            |---|---|---|---|
            | 4 · 기한 내 3 | 1 | 6 | 2 |

            ## 어제 한 일
            - 했음
            """);
  }

  @Test
  void fixTable_missingTable_templateWithoutTable_insertsNothing() {
    List<String> lines = lines("## 한 줄\n글\n\n## 어제 한 일\n- 했음");
    List<String> before = List.copyOf(lines);

    ReportMarkdown.fixTable(lines, dailyLikeSpec(), false);

    assertThat(lines).isEqualTo(before);
  }

  @Test
  void fixTable_tableInsideFence_ignored() {
    String fencedTable = "```\n| 끝냄 | 리뷰 |\n|---|---|\n| 9 | 9 |\n```";
    List<String> lines = lines("## 한 줄\n글\n\n" + fencedTable);

    ReportMarkdown.fixTable(lines, dailyLikeSpec(), false);

    // 펜스 안 표는 리포트 표로 보지 않는다 — 고치지 않고, 템플릿에 표가 없었으니 넣지도 않는다.
    assertThat(String.join("\n", lines)).isEqualTo("## 한 줄\n글\n\n" + fencedTable);
    assertThat(ReportMarkdown.hasTable(fencedTable, "끝냄"::equals)).isFalse();
    assertThat(ReportMarkdown.hasTable("| 끝냄 | 리뷰 |\n|---|---|", "끝냄"::equals)).isTrue();
  }

  @Test
  void clean_removesInstructionBoxH1AndNamedIssueLinks() {
    String md =
        "<div class=\"wp-ai-instruction\">x</div>\n# 제목\n[WP-1](https://w.example/projects/WP/issues/1)";

    List<String> lines = ReportMarkdown.clean(md, "https://w.example/projects/");

    String out = String.join("\n", lines);
    assertThat(out).doesNotContain("wp-ai-instruction").doesNotContain("# 제목");
    assertThat(lines).contains("https://w.example/projects/WP/issues/1");
    // 고칠 수 있는 목록이어야 한다(다음 단계가 줄을 넣고 뺀다).
    lines.add("끝");
  }
}
