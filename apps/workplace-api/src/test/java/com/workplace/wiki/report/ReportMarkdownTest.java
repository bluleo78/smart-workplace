package com.workplace.wiki.report;

import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.issue.metrics.MetricsSummary;
import com.workplace.issue.overview.status.StatusBadge;
import com.workplace.issue.report.PersonalReportFactsService;
import com.workplace.issue.report.PersonalReportKind;
import com.workplace.issue.report.ProjectReportEpics;
import com.workplace.issue.report.ProjectReportFacts;
import com.workplace.issue.report.ReportCadence;
import com.workplace.issue.report.ReportPeriod;
import com.workplace.issue.report.ReportSnapshot;
import com.workplace.issue.report.ReportTableRow;
import java.time.LocalDate;
import java.util.List;
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
        ProjectReportEpics.empty(),
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
    return ReportMarkdown.finish(md, facts(), templateHasTable, false, PREFIX);
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
            ProjectReportEpics.empty(),
            false);

    String out = ReportMarkdown.finish("## 상태와 한 줄\n\n**순조로움**\n", f, true, false, PREFIX);

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
        ReportMarkdown.finish(
            md, facts(StatusBadge.WARN, StatusBadge.ON_TRACK), false, false, PREFIX);

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
        ReportMarkdown.finish(md, facts(StatusBadge.WARN, StatusBadge.WARN), false, false, PREFIX);

    assertThat(out).contains("## 상태와 한 줄\n\n**주의**\n\n글");
    assertThat(out).doesNotContain("→");
  }

  @Test
  void fixBadge_insertsWhenMissing() {
    String md = "## 상태와 한 줄\n\n그냥 글\n";

    String out = ReportMarkdown.finish(md, facts(StatusBadge.RISK, null), false, false, PREFIX);

    assertThat(out).contains("## 상태와 한 줄\n\n**위험**\n\n그냥 글");
  }

  /** 「요약」도 「상태와 한 줄」도 없으면 맨 앞에 「## 요약」 + 진행 상태 줄(WP-1629 — 옛 맨 앞 굵은 배지 대신). */
  @Test
  void fixBadge_insertsAtTopWhenNoSection() {
    String out =
        ReportMarkdown.finish("글만 있음\n", facts(StatusBadge.RISK, null), false, false, PREFIX);

    assertThat(out).startsWith("## 요약\n\n- **진행 상태** 위험\n\n글만 있음");
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

    String out = ReportMarkdown.finish(md, facts(StatusBadge.RISK, null), false, false, PREFIX);

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
        ReportMarkdown.finish(md, facts(StatusBadge.RISK, StatusBadge.WARN), false, false, PREFIX);

    assertThat(out).contains("## 상태와 한 줄\n\n**위험** · 주의 → 위험\n\n글");
    assertThat(out).doesNotContain("상태: 주의");
  }

  /** 첫 문단 둘째 줄(소프트 줄바꿈)에 있는 굵은 배지도 그 줄을 바꾼다 — 배지 줄이 둘 생기지 않는다. */
  @Test
  void fixBadge_replacesBadgeInsideFirstParagraph() {
    String md = "## 상태와 한 줄\n\n이번 주 상태\n**주의**\n\n글\n";

    String out = ReportMarkdown.finish(md, facts(StatusBadge.RISK, null), false, false, PREFIX);

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
        List.of("한 줄"));
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

  // ───────────── 개인 기본 템플릿(WP-1632) — 새 순서에서도 숫자 표를 찾고 없으면 「막힌 것」 뒤에 넣는다 ─────────────

  /** 어제 끝냄 5(기한 내 2, AI와 함께 3)·새로 만듦 1 지표. */
  private static final MetricsSummary DAY_METRICS =
      new MetricsSummary(5, 3, 1, 2, 0, 0, null, null, null, null);

  /** 주간 「지난주 대비」 표 모양 — 이번·지난 기간 모두 {@link #DAY_METRICS}(변화 0), 기한 지남 0. */
  private static final ReportTableSpec WEEKLY_SPEC =
      PersonalReportFactsService.periodSpec(PersonalReportKind.WEEKLY, DAY_METRICS, DAY_METRICS, 0);

  /** 기본 일일 템플릿을 그대로 고쳐도 「어제 숫자」 표만 시스템 값으로 바뀌고 「오늘 할 일」 표는 그대로다. */
  @Test
  void personalDailyTemplate_fixTable_rewritesYesterdayNumbersOnly() {
    String template = ReportTemplateCopier.loadResource("report/personal-daily-template.md");
    assertThat(ReportMarkdown.hasTable(template, PersonalReportFactsService.DAILY_HEAD)).isTrue();
    List<String> lines = lines(template);

    ReportMarkdown.fixTable(lines, PersonalReportFactsService.dailySpec(DAY_METRICS, 6, 1), true);

    String out = String.join("\n", lines);
    int section = out.indexOf("## 어제 숫자");
    assertThat(section).isPositive();
    assertThat(out.substring(section))
        .contains("| 끝냄 | 새로 만듦 | 상태 바꿈 | 기한 지남 |")
        .contains("| 5 · 기한 내 2 · AI와 함께 3 | 1 | 6 | 1 |")
        .doesNotContain("| 7 · 기한 내 3 · AI와 함께 5 | 1 | 6 | 1 |");
    assertThat(out).contains("| 1 | {{BASE_URL}}/projects/WP/issues/1301 | AI 개발자3이 답을 기다림 |");
  }

  /** 새 순서의 일일 글에 숫자 표가 없으면 「막힌 것」 뒤(맨 끝)에 「어제 숫자」 표를 넣는다. */
  @Test
  void personalDaily_missingTable_insertedAfterBlockedSection() {
    List<String> lines = lines("## 요약\n글\n\n## 어제 한 일\n- 했음\n\n## 오늘 할 일\n- 할 일\n\n## 막힌 것\n- 없음");

    ReportMarkdown.fixTable(lines, PersonalReportFactsService.dailySpec(DAY_METRICS, 6, 1), true);

    assertThat(ReportMarkdown.render(lines))
        .endsWith(
            """
            ## 막힌 것
            - 없음

            ## 어제 숫자

            | 끝냄 | 새로 만듦 | 상태 바꿈 | 기한 지남 |
            |---|---|---|---|
            | 5 · 기한 내 2 · AI와 함께 3 | 1 | 6 | 1 |
            """);
  }

  /**
   * 옛 순서(「한 줄」 → 숫자 표 → …)를 쓰는 사람(옛 템플릿 페이지는 그대로 남는다)의 글에 표가 없으면 예전처럼 「한 줄」 뒤에 넣는다 — 새 순서의 「막힌 것」
   * 뒤로 옮기지 않는다(넣을 자리는 앞 후보부터 있는 섹션을 쓴다).
   */
  @Test
  void personalDaily_oldTemplateOrder_missingTable_insertedAfterOneLine() {
    List<String> lines = lines("## 한 줄\n글\n\n## 어제 한 일\n- 했음\n\n## 막힌 것\n- 없음");

    ReportMarkdown.fixTable(lines, PersonalReportFactsService.dailySpec(DAY_METRICS, 6, 1), true);

    String out = ReportMarkdown.render(lines);
    assertThat(out)
        .startsWith(
            """
            ## 한 줄
            글

            ## 어제 숫자

            | 끝냄 | 새로 만듦 | 상태 바꿈 | 기한 지남 |
            """);
    assertThat(out).endsWith("## 막힌 것\n- 없음\n");
  }

  /** 주간도 같다 — 옛 순서 글은 「한 줄」 뒤, 표가 맨 끝으로 가지 않는다. */
  @Test
  void personalWeekly_oldTemplateOrder_missingTable_insertedAfterOneLine() {
    List<String> lines = lines("## 한 줄\n글\n\n## 한 일\n- 했음\n\n## 막힌 것\n- 없음");

    ReportMarkdown.fixTable(lines, WEEKLY_SPEC, true);

    String out = ReportMarkdown.render(lines);
    assertThat(out.indexOf("## 지난주 대비")).isGreaterThan(out.indexOf("## 한 줄"));
    assertThat(out.indexOf("## 지난주 대비")).isLessThan(out.indexOf("## 한 일"));
  }

  /** 기본 주간 템플릿은 맨 끝 「지난주 대비」 표를 갖고, 새 순서의 주간 글에 표가 없으면 「막힌 것」 뒤에 넣는다. */
  @Test
  void personalWeeklyTemplate_tableAtEnd_missingInsertedAfterBlocked() {
    String template = ReportTemplateCopier.loadResource("report/personal-weekly-template.md");
    assertThat(ReportMarkdown.hasTable(template, PersonalReportFactsService.PERIOD_HEAD)).isTrue();
    assertThat(template.indexOf("## 지난주 대비")).isGreaterThan(template.indexOf("## 막힌 것"));

    List<String> fixed = lines(template);
    ReportMarkdown.fixTable(fixed, WEEKLY_SPEC, true);
    assertThat(String.join("\n", fixed)).contains("| 끝냄 | 5 | 0 |");

    List<String> lines = lines("## 요약\n글\n\n## 이번 주 한 일\n- 했음\n\n## 막힌 것\n- 없음");
    ReportMarkdown.fixTable(lines, WEEKLY_SPEC, true);
    String out = ReportMarkdown.render(lines);
    assertThat(out.indexOf("## 지난주 대비")).isGreaterThan(out.indexOf("## 막힌 것"));
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

  // ───────────── 새 모양(WP-1629) — 진행 상태 줄 / 참고 지표 표 / 일정 도표 ─────────────

  private static final List<ProjectReportEpics.ReportMetric> METRICS =
      List.of(
          new ProjectReportEpics.ReportMetric("완료한 에픽", "4", "4"),
          new ProjectReportEpics.ReportMetric("기한 내 완료", "0/3", "3/4"),
          new ProjectReportEpics.ReportMetric("완료한 이슈", "163", "189"),
          new ProjectReportEpics.ReportMetric("릴리스", "14회", "10회"),
          new ProjectReportEpics.ReportMetric("기한 초과 미완료 이슈", "0", "0"));

  private static final String METRICS_BODY =
      """
      | 완료한 에픽 | 4 | 4 |
      | 기한 내 완료 | 0/3 | 3/4 |
      | 완료한 이슈 | 163 | 189 |
      | 릴리스 | 14회 | 10회 |
      | 기한 초과 미완료 이슈 | 0 | 0 |""";

  /** spike 데이터의 에픽 집계 — 이번 주 완료 4개(하나는 기한 없음), 지난주 4개. */
  private static ProjectReportEpics spikeEpics(boolean withDue) {
    List<ProjectReportEpics.CompletedEpic> completed =
        List.of(
            completed("WP-1245", "AI 에이전트 직접 실행 지원", withDue ? "11/6" : null, "11/9", 3),
            completed("WP-1447", "AI 계정 관리와 사용량 모니터링", withDue ? "11/11" : null, "11/14", 3),
            completed("WP-1503", "도움말 기능 강화", null, "11/14", null));
    List<ProjectReportEpics.PastEpic> previous =
        withDue
            ? List.of(
                new ProjectReportEpics.PastEpic("WP-718", "외부 AI 에이전트 연동 개선", "10/30", "11/2", 3),
                new ProjectReportEpics.PastEpic("WP-1310", "반복 AI 작업", "11/6", "11/3", -3))
            : List.of();
    return new ProjectReportEpics(
        completed, previous, List.of(), List.of(), List.of(), 0, List.of(), List.of(), METRICS,
        "소유자");
  }

  private static ProjectReportEpics.CompletedEpic completed(
      String key, String title, String due, String done, Integer late) {
    return new ProjectReportEpics.CompletedEpic(
        key, "u/" + key, title, due, done, due == null ? null : late, 1, null, List.of());
  }

  private static ProjectReportFacts newFacts(
      StatusBadge badge, StatusBadge previous, boolean withDue) {
    ReportPeriod period =
        new ReportPeriod(
            LocalDate.parse("2026-11-09"), LocalDate.parse("2026-11-15"), ReportCadence.WEEKLY);
    return new ProjectReportFacts(
        period,
        badge,
        previous,
        ROWS,
        new ReportSnapshot(2, 3, 10, 1, badge.name()),
        spikeEpics(withDue),
        false);
  }

  private static String finishNew(String md, boolean withDue, boolean templateHasMetrics) {
    return ReportMarkdown.finish(
        md,
        newFacts(StatusBadge.ON_TRACK, StatusBadge.WARN, withDue),
        false,
        templateHasMetrics,
        PREFIX);
  }

  private static int count(String s, String part) {
    return s.split(java.util.regex.Pattern.quote(part), -1).length - 1;
  }

  /** (a) 「{{일정 도표}}」 줄 → 그 자리에 도표 블록 하나, 토큰 글자는 사라진다. */
  @Test
  void chart_replacesTokenLine() {
    String md = "## 일정\n\n기한을 넘겼습니다.\n\n{{일정 도표}}\n\n- 근거\n";

    String out = finishNew(md, true, false);

    assertThat(out).doesNotContain("{{일정 도표}}");
    assertThat(count(out, "```html-embed")).isEqualTo(1);
    assertThat(out).contains("기한을 넘겼습니다.\n\n```html-embed\n");
    assertThat(out).contains("\n```\n\n- 근거");
  }

  /** (b) 토큰 두 번 → 도표 블록 하나(뒤 토큰 줄은 지움). */
  @Test
  void chart_tokenTwice_singleBlock() {
    String md = "## 일정\n\n글\n\n{{일정 도표}}\n\n- 근거\n\n  {{일정 도표}}  \n\n끝\n";

    String out = finishNew(md, true, false);

    assertThat(count(out, "```html-embed")).isEqualTo(1);
    assertThat(out).doesNotContain("{{일정 도표}}");
    assertThat(out).contains("- 근거\n\n끝");
  }

  /** (c) 토큰이 없으면 「## 일정」 첫 문단 뒤에 넣는다. */
  @Test
  void chart_noToken_insertsAfterFirstParagraphOfSchedule() {
    String md = "## 일정\n\n판단 한 문장.\n둘째 줄.\n\n- 근거\n\n## 진행 중인 에픽\n";

    String out = finishNew(md, true, false);

    assertThat(count(out, "```html-embed")).isEqualTo(1);
    assertThat(out).contains("판단 한 문장.\n둘째 줄.\n\n```html-embed\n");
    assertThat(out.indexOf("```html-embed")).isLessThan(out.indexOf("- 근거"));
  }

  /** 토큰도 「일정」 섹션도 없으면 도표를 넣지 않는다. */
  @Test
  void chart_noTokenNoSection_nothing() {
    String out = finishNew("## 주요 성과\n\n글\n", true, false);

    assertThat(out).doesNotContain("html-embed");
  }

  /** (d) 도표를 만들 수 없으면(기한 정한 완료 에픽 없음) 토큰 줄만 지운다. */
  @Test
  void chart_impossible_removesTokenLine() {
    String md = "## 일정\n\n글\n\n{{일정 도표}}\n\n- 근거\n";

    String out = finishNew(md, false, false);

    assertThat(out).doesNotContain("{{일정 도표}}").doesNotContain("html-embed");
    assertThat(out).contains("## 일정\n\n글\n\n- 근거");
  }

  /** 목록 항목·문장 안에 든 토큰 — 글자는 남지 않고 도표는 한 번만. */
  @Test
  void chart_strayTokensRemoved() {
    String md = "## 일정\n\n글\n\n- {{일정 도표}}\n\n아래 {{일정 도표}} 를 보세요.\n";

    String out = finishNew(md, true, false);

    assertThat(out).doesNotContain("{{일정 도표}}");
    assertThat(count(out, "```html-embed")).isEqualTo(1);
    assertThat(out).doesNotContain("\n- \n").doesNotContain("\n-\n");
    assertThat(out).contains("아래 를 보세요.");
  }

  /** (j) 펜스 안 토큰은 건드리지 않는다(진짜 토큰 줄은 바뀜). */
  @Test
  void chart_tokenInsideFenceUntouched() {
    String md = "## 일정\n\n글\n\n```\n{{일정 도표}}\n```\n\n{{일정 도표}}\n";

    String out = finishNew(md, true, false);

    assertThat(out).contains("```\n{{일정 도표}}\n```");
    assertThat(count(out, "```html-embed")).isEqualTo(1);
    assertThat(count(out, "{{일정 도표}}")).isEqualTo(1);
  }

  /** (e) 「요약」의 진행 상태 줄을 시스템 값으로(지금 순조로움, 지난 주의). */
  @Test
  void status_rewritesSummaryStatusLine() {
    String md =
        """
        ## 요약

        판단 두 문장입니다.

        - **진행 상태** 주의 (지난주 순조로움)
        - **주의** 통합 검색 기한 초과 예상
        """;

    String out = finishNew(md, true, false);

    assertThat(out).contains("- **진행 상태** 순조로움 (지난주 주의)\n- **주의** 통합 검색 기한 초과 예상");
    assertThat(count(out, "**진행 상태**")).isEqualTo(1);
    // 옛 배지 줄(굵은 「주의」)을 따로 넣지 않는다.
    assertThat(out).doesNotContain("**순조로움**");
  }

  /** 콜론 위치가 다른 진행 상태 줄 변형도 같은 줄로 찾아 한 줄로 고친다 — AI 낱말(위험)이 남지 않는다(WP-1629). */
  @Test
  void status_replacesColonVariantsWithSingleLine() {
    for (String variant :
        List.of("- **진행 상태:** 위험", "- **진행 상태: 위험**", "- **진행 상태** : 위험", "- **진행 상태：** 위험")) {
      String md = "## 요약\n\n판단 두 문장입니다.\n\n" + variant + "\n- **성과** 에픽 4개\n";

      String out = finishNew(md, true, false);

      assertThat(out).as(variant).contains("- **진행 상태** 순조로움 (지난주 주의)\n- **성과** 에픽 4개");
      assertThat(count(out, "진행 상태")).as(variant).isEqualTo(1);
      assertThat(out).as(variant).doesNotContain("위험");
    }
  }

  /** 진행 상태 줄이 없으면 첫 목록 줄 앞에, 목록도 없으면 첫 문단 뒤에. 지난 배지 없으면 괄호 생략. */
  @Test
  void status_insertsBeforeFirstListOrAfterParagraph() {
    String withList = "## 요약\n\n판단.\n\n- **성과** 에픽 4개\n";
    String out1 =
        ReportMarkdown.finish(
            withList, newFacts(StatusBadge.WARN, null, true), false, false, PREFIX);
    assertThat(out1).contains("판단.\n\n- **진행 상태** 주의\n- **성과** 에픽 4개");

    String noList = "## 요약\n\n판단.\n\n## 주요 성과\n";
    String out2 =
        ReportMarkdown.finish(noList, newFacts(StatusBadge.RISK, null, true), false, false, PREFIX);
    assertThat(out2).contains("## 요약\n\n판단.\n\n- **진행 상태** 위험\n\n## 주요 성과");
  }

  /** 주기 낱말 — 월간은 「지난달」. */
  @Test
  void status_monthlyWord() {
    ReportPeriod period =
        new ReportPeriod(
            LocalDate.parse("2026-10-01"), LocalDate.parse("2026-10-31"), ReportCadence.MONTHLY);
    ProjectReportFacts f =
        new ProjectReportFacts(
            period,
            StatusBadge.WARN,
            StatusBadge.ON_TRACK,
            ROWS,
            new ReportSnapshot(0, 0, 0, 0, "WARN"),
            ProjectReportEpics.empty(),
            false);

    String out = ReportMarkdown.finish("## 요약\n\n판단.\n", f, false, false, PREFIX);

    assertThat(out).contains("- **진행 상태** 주의 (지난달 순조로움)");
  }

  /** (f) 「요약」도 「상태와 한 줄」도 없으면 맨 앞에 「## 요약」 + 진행 상태 줄 하나. */
  @Test
  void status_noSummaryNoOldSection_insertsSummaryAtTop() {
    String md = "## 주요 성과\n\n### 무엇\n\n- 결과\n";

    String out = finishNew(md, true, false);

    assertThat(out).startsWith("## 요약\n\n- **진행 상태** 순조로움 (지난주 주의)\n\n## 주요 성과");
    assertThat(count(out, "**진행 상태**")).isEqualTo(1);
  }

  /** 옛 표를 넣어야 하는데 섹션이 다 없으면 맨 앞에 넣은 「요약」 섹션 뒤에 — 제목과 진행 상태 줄 사이에 끼지 않는다. */
  @Test
  void oldTable_insertedAfterInsertedSummary() {
    String out = finish("## 한 일\n\n- 무엇\n", true);

    assertThat(out)
        .startsWith(
            "## 요약\n\n- **진행 상태** 순조로움 (지난주 순조로움)\n\n## 지난 리포트 이후\n\n"
                + "| 지난 리포트 이후 | 이번 | 변화 |\n|---|---|---|\n"
                + SYSTEM_BODY
                + "\n\n## 한 일");
  }

  /** (g) 옛 「상태와 한 줄」 모양은 기존 배지 동작 그대로. */
  @Test
  void status_oldTemplate_keepsBadgeBehavior() {
    String md = "## 상태와 한 줄\n\n**위험**\n\n글\n";

    String out = finishNew(md, true, false);

    assertThat(out).startsWith("## 상태와 한 줄\n\n**순조로움** · 주의 → 순조로움\n\n글");
    assertThat(out).doesNotContain("진행 상태").doesNotContain("## 요약");
  }

  /** (h) 참고 지표 표 몸통은 AI 가 숫자를 틀려도 계산값 다섯 줄로(머리 줄은 그대로). */
  @Test
  void metrics_rewritesBody() {
    String md =
        """
        ## 참고 지표

        | 지표 | 이번 주 | 지난주 |
        | --- | --- | --- |
        | 완료한 에픽 | 99 | 4 |
        | 아무 지표 | 1 | 1 |
        """;

    String out = finishNew(md, true, true);

    assertThat(out).contains("| 지표 | 이번 주 | 지난주 |\n|---|---|---|\n" + METRICS_BODY);
    assertThat(out).doesNotContain("99").doesNotContain("아무 지표");
  }

  /** (i) 표가 없고 템플릿에 있었으면 문서 끝에 「## 참고 지표」 표. 템플릿에 없었으면 넣지 않는다. */
  @Test
  void metrics_insertsAtEnd_whenTemplateHadIt() {
    String md = "## 요약\n\n판단.\n\n## 결정 요청\n\n없음\n";

    String out = finishNew(md, true, true);

    assertThat(out)
        .endsWith(
            "## 결정 요청\n\n없음\n\n## 참고 지표\n\n| 지표 | 이번 주 | 지난주 |\n|---|---|---|\n"
                + METRICS_BODY
                + "\n");
    assertThat(finishNew(md, true, false)).doesNotContain("참고 지표");
  }

  /** 월간·격주 리포트는 템플릿의 「이번 주 | 지난주」 머리를 주기 낱말로 고친다(WP-1629). */
  @Test
  void metrics_headFollowsCadence() {
    List<com.workplace.issue.report.ProjectReportEpics.ReportMetric> ms =
        List.of(new com.workplace.issue.report.ProjectReportEpics.ReportMetric("완료한 에픽", "1", "2"));
    for (String[] c :
        new String[][] {
          {"MONTHLY", "이번 달", "지난달"}, {"BIWEEKLY", "이번 기간", "지난 기간"}, {"WEEKLY", "이번 주", "지난주"}
        }) {
      List<String> lines =
          new java.util.ArrayList<>(
              List.of(
                  "## 참고 지표", "", "| 지표 | 이번 주 | 지난주 |", "| --- | --- | --- |", "| 아무 | 1 | 1 |"));

      ReportMarkdown.fixTable(
          lines,
          com.workplace.wiki.report.ReportTableSpec.metrics(ms, ReportCadence.valueOf(c[0])),
          true);

      assertThat(lines)
          .as(c[0])
          .contains("| 지표 | " + c[1] + " | " + c[2] + " |", "| 완료한 에픽 | 1 | 2 |");
      assertThat(String.join("\n", lines)).as(c[0]).doesNotContain("아무");
    }
  }

  /** 「**진행 상태가 늦은 에픽**」 같은 다른 굵은 글은 진행 상태 줄이 아니다 — 지우지 않고 상태 줄도 한 번만(WP-1629). */
  @Test
  void status_doesNotTreatOtherBoldStartingWithPhraseAsStatusLine() {
    String md = "## 요약\n\n판단.\n\n- **진행 상태가 늦은 에픽** 통합 검색\n- **성과** 에픽 4개\n";

    String out = finishNew(md, true, false);

    assertThat(out).contains("- **진행 상태가 늦은 에픽** 통합 검색");
    assertThat(count(out, "- **진행 상태** ")).isEqualTo(1);
    assertThat(out).contains("- **성과** 에픽 4개");
  }

  @Test
  void hasMetricsTable_detectsTemplateTable() {
    assertThat(ReportMarkdown.hasMetricsTable("| 지표 | 이번 주 | 지난주 |\n| --- | --- | --- |")).isTrue();
    assertThat(ReportMarkdown.hasMetricsTable("| 지난 리포트 이후 | 이번 | 변화 |\n|---|---|---|")).isFalse();
  }

  /** 새 모양 카드 — 배지는 진행 상태 줄 낱말, 한 줄은 「요약」 첫 글 문단. */
  @Test
  void cardSummary_newShape_readsStatusLineAndJudgment() {
    String md =
        """
        ## 요약

        이번 주 에픽 4개를 마쳤습니다. **다만** 기한을 넘겼습니다.

        - **진행 상태** 순조로움 (지난주 주의)
        - **주의** 기한 초과

        ## 주요 성과
        """;

    ReportMarkdown.CardSummary s = ReportMarkdown.cardSummary(md);

    assertThat(s.badge()).isEqualTo("ON_TRACK");
    assertThat(s.line()).isEqualTo("이번 주 에픽 4개를 마쳤습니다. 다만 기한을 넘겼습니다.");
  }

  /**
   * 「요약」·「상태와 한 줄」 없이 다른 절로 시작한 AI 글 — finish 가 맨 앞에 「## 요약」 + 진행 상태 줄만 넣어 요약 절에 글 문단이 없어도 카드 한 줄은
   * 문서의 첫 글 문단(옛 카드와 같음, 리뷰 반영). 배지는 넣은 진행 상태 줄 낱말, 목록·제목·진행 상태 줄은 한 줄로 쓰지 않는다.
   */
  @Test
  void cardSummary_noSummaryNoStatusSection_fallsBackToFirstProse() {
    String ai =
        """
        ## 주요 성과

        - 목록이 먼저 와도 한 줄이 아니다

        이번 주는 결제 개편을 마쳤습니다. **다음 주** 배포합니다.

        ## 다음 할 일

        둘째 문단
        """;

    String out = ReportMarkdown.finish(ai, facts(StatusBadge.WARN, null), false, false, PREFIX);
    ReportMarkdown.CardSummary s = ReportMarkdown.cardSummary(out);

    assertThat(out).startsWith("## 요약\n\n- **진행 상태** 주의\n");
    assertThat(s.badge()).isEqualTo("WARN");
    assertThat(s.line()).isEqualTo("이번 주는 결제 개편을 마쳤습니다. 다음 주 배포합니다.");
  }

  /** 지난 리포트가 바로 앞 기간이 아니면 진행 상태 줄은 「(지난 리포트 …)」 로 견준다 — 건너뛴 회차가 끼면 「지난주」가 틀리다(WP-1629 리뷰). */
  @Test
  void fixStatus_lastReportNotPreviousPeriod_saysLastReport() {
    ProjectReportFacts f =
        facts(StatusBadge.RISK, StatusBadge.WARN).withPreviousFromPreviousPeriod(false);

    String out = ReportMarkdown.finish("## 요약\n\n판단입니다.\n", f, false, false, PREFIX);
    String adjacent =
        ReportMarkdown.finish(
            "## 요약\n\n판단입니다.\n", facts(StatusBadge.RISK, StatusBadge.WARN), false, false, PREFIX);

    assertThat(out).contains("- **진행 상태** 위험 (지난 리포트 주의)").doesNotContain("지난주");
    assertThat(adjacent).contains("- **진행 상태** 위험 (지난주 주의)");
  }

  /** 「요약」에 진행 상태 줄(목록)만 있고 문서 어디에도 글 문단이 없으면 한 줄은 null — 진행 상태 줄을 되풀이하지 않는다. */
  @Test
  void cardSummary_onlyStatusLine_lineNull() {
    ReportMarkdown.CardSummary s =
        ReportMarkdown.cardSummary("## 요약\n\n- **진행 상태** 위험\n\n## 일정\n\n- 목록만\n");

    assertThat(s.badge()).isEqualTo("RISK");
    assertThat(s.line()).isNull();
  }

  /** 기본 템플릿 + spike 출력 흐름 — 도표 한 번, 진행 상태 한 번, 지표 표 한 번. */
  @Test
  void finish_spikeShapedOutput_endToEnd() {
    String md =
        """
        ## 요약

        판단.

        - **진행 상태** 순조로움 (지난주 순조로움)
        - **주의** 기한 초과

        ## 일정

        판단.

        {{일정 도표}}

        - 근거

        ## 참고 지표

        | 지표 | 이번 주 | 지난주 |
        | --- | --- | --- |
        | 완료한 에픽 | 4 | 4 |
        """;

    String out = finishNew(md, true, true);

    assertThat(count(out, "```html-embed")).isEqualTo(1);
    assertThat(count(out, "**진행 상태**")).isEqualTo(1);
    assertThat(count(out, "| 지표 |")).isEqualTo(1);
    assertThat(out).contains(METRICS_BODY);
  }
}
