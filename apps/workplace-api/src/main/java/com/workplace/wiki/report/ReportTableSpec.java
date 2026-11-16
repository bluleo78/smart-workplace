package com.workplace.wiki.report;

import com.workplace.issue.report.PersonalReportKind;
import com.workplace.issue.report.PersonalReportWork.ProjectWork;
import com.workplace.issue.report.ProjectReportEpics.ReportMetric;
import com.workplace.issue.report.ReportCadence;
import com.workplace.issue.report.ReportNumbers;
import com.workplace.issue.report.ReportTableRow;
import java.util.List;
import java.util.function.Predicate;

/**
 * 리포트 표 하나의 모양(WP-1486) — {@link ReportMarkdown#fixTable} 이 AI 글 속 표를 찾아 시스템 값으로 다시 쓰고, 없으면 넣을 때
 * 쓴다. 프로젝트 리포트(WP-1483)의 「지난 리포트 이후」 표와 개인 보고의 「어제 숫자」·「지난주 대비」 표가 같은 후처리를 나눠 쓰게 표 모양만 값으로 뺐다.
 *
 * @param headFirstCell 머리 첫 칸(굵게·앞뒤 공백을 뗀 글)을 받아 이 표의 머리인지 판정한다
 * @param headCells 시스템이 정한 머리 칸 — null 이면 찾은 표의 머리·구분 줄을 그대로 두고 몸통만 다시 쓴다(프로젝트). null 이 아니면 머리 줄·구분
 *     줄({@code |---|…|}, 칸 수 맞춤)까지 이 값으로 다시 쓴다(개인 일일 — 칸 자체가 시스템 지표)
 * @param body 몸통 행(행마다 칸 값). 칸 값의 「|」 는 쓸 때 이스케이프한다
 * @param insertSectionTitle 표가 없을 때 표 앞에 넣는 h2 제목. headCells 가 null 이면 넣는 표의 머리도 {@code | 이 제목 | 이번
 *     | 변화 |} 로 만든다(프로젝트 표의 머리 모양)
 * @param insertAfterSections 표를 넣을 자리 후보 — 앞 후보부터 제목이 그 글로 시작하는 섹션을 찾아 처음 찾은 섹션의 끝에 넣는다. 하나도 없으면 첫
 *     문단 뒤. 후보가 여럿인 것은 개인 보고(WP-1632)가 옛 템플릿 순서(「한 줄」 뒤)와 새 템플릿 순서(「막힌 것」 뒤 = 맨 끝)를 함께 받고, 프로젝트
 *     리포트(WP-1629)가 옛 「상태와 한 줄」 과 새 「요약」 을 함께 받기 때문이다
 * @param insertAtEnd true 면 insertAfterSections 대신 문서 끝에 넣는다(WP-1629 「참고 지표」 — 보고서 맨 끝 절)
 * @param keepAi null 이 아니면 AI 가 쓴 칸 일부를 살린다(WP-1632 개인 주간·월간 프로젝트 표의 「주요 내용」) — 건수 칸은 시스템 값으로 다시
 *     쓰되, AI 행을 첫 칸(프로젝트 이름·키)으로 시스템 행에 맞춰 지정한 칸의 글을 옮긴다
 * @param insertIntoSection null 이 아니면 표가 없을 때 제목이 이 판정을 통과하는 절의 처음(제목 줄 바로 뒤)에 h2 없이 넣는다(WP-1632
 *     「이번 주 한 일」). 맞는 절이 없으면 insertSectionTitle·insertAfterSections 경로로 넣는다
 */
public record ReportTableSpec(
    Predicate<String> headFirstCell,
    List<String> headCells,
    List<List<String>> body,
    String insertSectionTitle,
    List<String> insertAfterSections,
    boolean insertAtEnd,
    KeepAiColumns keepAi,
    Predicate<String> insertIntoSection) {

  /**
   * AI 칸 살리기(WP-1632).
   *
   * @param columns 살릴 칸 번호(0 부터) — 시스템 행의 이 칸은 맞는 AI 행의 같은 칸 글로 바꾼다(없거나 비면 「—」)
   * @param rowKeys 시스템 행마다 AI 행 첫 칸과 맞춰 볼 이름들(우선순위 순 — 프로젝트 키 → 이름, AI 가 어느 쪽을 써도 맞게). body 와 같은
   *     길이. 모든 행의 앞 순위 이름으로 먼저 맞춘 뒤 다음 순위로 맞추고, AI 행 하나는 한 시스템 행에만 쓴다
   * @param maxLength 살린 글의 최대 길이(코드 포인트, 넘치면 「…」)
   */
  public record KeepAiColumns(List<Integer> columns, List<List<String>> rowKeys, int maxLength) {}

  /** AI 칸 살리기의 맞춤 이름은 몸통 행마다 하나씩이어야 한다 — 어긋나면 행을 잘못 맞추므로 만들 때 막는다. */
  public ReportTableSpec {
    if (keepAi != null && keepAi.rowKeys().size() != body.size()) {
      throw new IllegalArgumentException("keepAi.rowKeys 와 body 의 행 수가 달라요");
    }
  }

  /** AI 칸 살리기·절 처음 넣기 없는 표(기존 모양). */
  public ReportTableSpec(
      Predicate<String> headFirstCell,
      List<String> headCells,
      List<List<String>> body,
      String insertSectionTitle,
      List<String> insertAfterSections,
      boolean insertAtEnd) {
    this(
        headFirstCell,
        headCells,
        body,
        insertSectionTitle,
        insertAfterSections,
        insertAtEnd,
        null,
        null);
  }

  /** 섹션 뒤에 넣는 표(기존 모양) — 넣을 때 머리는 headCells 규칙, 자리는 insertAfterSections 후보. */
  public ReportTableSpec(
      Predicate<String> headFirstCell,
      List<String> headCells,
      List<List<String>> body,
      String insertSectionTitle,
      List<String> insertAfterSections) {
    this(headFirstCell, headCells, body, insertSectionTitle, insertAfterSections, false);
  }

  /** 프로젝트 리포트 표의 머리 첫 칸 접두이자 넣을 때의 섹션 제목. */
  static final String PROJECT_TABLE_HEAD = "지난 리포트 이후";

  /** 프로젝트 리포트에서 표를 둘 섹션(배지 줄 섹션). */
  static final String PROJECT_STATUS_SECTION = "상태와 한 줄";

  /** 새 모양(WP-1629) 프로젝트 리포트의 진행 상태 줄 섹션 — 「상태와 한 줄」 이 없을 때 옛 표를 둘 다음 자리. */
  static final String PROJECT_SUMMARY_SECTION = "요약";

  /**
   * 프로젝트 리포트(WP-1483)의 「지난 리포트 이후」 표 — 머리 첫 칸이 「지난 리포트 이후」 로 시작하는 표의 몸통만 계산값 행으로 다시 쓰고, 없으면 「상태와 한
   * 줄」 섹션 뒤(그 섹션이 없으면 새 모양의 「요약」 섹션 뒤, WP-1629 — 「요약」 제목과 진행 상태 줄 사이에 끼지 않게)에 {@code | 지난 리포트 이후 |
   * 이번 | 변화 |} 표를 넣는다.
   */
  public static ReportTableSpec project(List<ReportTableRow> rows) {
    List<List<String>> body =
        rows.stream().map(r -> List.of(nz(r.label()), nz(r.current()), nz(r.change()))).toList();
    return new ReportTableSpec(
        s -> s.startsWith(PROJECT_TABLE_HEAD),
        null,
        body,
        PROJECT_TABLE_HEAD,
        List.of(PROJECT_STATUS_SECTION, PROJECT_SUMMARY_SECTION));
  }

  /** 「참고 지표」 표의 머리 첫 칸이자 넣을 때의 섹션 제목(WP-1629). */
  static final String METRICS_HEAD = "지표";

  /** 「참고 지표」 표를 넣을 때의 섹션 제목. */
  static final String METRICS_SECTION = "참고 지표";

  /**
   * 프로젝트 리포트(WP-1629)의 「참고 지표」 표 — 머리 첫 칸이 「지표」인 표의 머리(주기 낱말)·몸통을 다시 쓰고(지표 다섯 줄), 없으면 문서 끝에 {@code
   * ## 참고 지표} 와 {@code | 지표 | 이번 주 | 지난주 |}(주기 낱말 맞춤) 표를 넣는다.
   */
  public static ReportTableSpec metrics(List<ReportMetric> metrics, ReportCadence cadence) {
    List<List<String>> body =
        metrics.stream()
            .map(m -> List.of(nz(m.label()), nz(m.current()), nz(m.previous())))
            .toList();
    // 머리도 주기 낱말로 다시 쓴다 — 템플릿의 「이번 주 | 지난주」 머리가 월간·격주 리포트에 남지 않게(WP-1629).
    List<String> head = List.of(METRICS_HEAD, cadence.currentWord(), cadence.previousWord());
    return new ReportTableSpec(METRICS_HEAD::equals, head, body, METRICS_SECTION, List.of(), true);
  }

  /** 개인 주간·월간 프로젝트 표의 머리 첫 칸(WP-1632). */
  public static final String WORK_HEAD = "프로젝트";

  /** 프로젝트 표 「주요 내용」 칸의 최대 길이 — 안내는 20자 안팎, 넘쳐도 표가 한 줄로 보이게 40자에서 자른다. */
  static final int WORK_SUMMARY_MAX = 40;

  /**
   * 개인 주간·월간 보고(WP-1632)의 프로젝트별 끝낸 일 표 {@code | 프로젝트 | 끝낸 일 | 주요 내용 |} — 건수는 시스템 값, 「주요 내용」 은 AI 글을
   * 프로젝트 키·이름으로 맞춰 살리고, 「이번 주/달 한 일」 절 안에서만 찾고 넣는다. 끝낸 일이 없으면 한 행 「— | 0건 | 끝낸 일 없음」(예시 표의 가짜 건수가
   * 남지 않게).
   *
   * @param projects 끝낸 일 집계의 프로젝트(시스템 순서)
   * @param kind 보고 종류 — 맞는 절이 없을 때 새로 만드는 절 제목에 쓴다
   */
  public static ReportTableSpec personalWork(List<ProjectWork> projects, PersonalReportKind kind) {
    boolean none = projects.isEmpty();
    List<List<String>> body =
        none
            ? List.of(List.of(ReportNumbers.DASH, "0건", NO_WORK_TEXT))
            : projects.stream()
                .map(p -> List.of(nz(p.projectName()), p.done() + "건", ReportNumbers.DASH))
                .toList();
    // 맞춤 순서 — 키 먼저(워크스페이스 안에서 하나뿐), 그다음 이름(같은 이름 프로젝트가 있을 수 있다).
    List<List<String>> keys =
        projects.stream().map(p -> List.of(nz(p.projectKey()), nz(p.projectName()))).toList();
    String section = kind == PersonalReportKind.MONTHLY ? MONTH_DONE_SECTION : WEEK_DONE_SECTION;
    return new ReportTableSpec(
        s -> s.startsWith(WORK_HEAD),
        List.of(WORK_HEAD, "끝낸 일", "주요 내용"),
        body,
        section,
        List.of(PERSONAL_SUMMARY_SECTION),
        false,
        none ? null : new KeepAiColumns(List.of(2), keys, WORK_SUMMARY_MAX),
        t -> t.startsWith(WEEK_DONE_SECTION) || t.startsWith(MONTH_DONE_SECTION));
  }

  /** 끝낸 일이 없는 기간의 시스템 행 「주요 내용」 글. */
  static final String NO_WORK_TEXT = "끝낸 일 없음";

  /** 주간 「한 일」 절 제목. */
  static final String WEEK_DONE_SECTION = "이번 주 한 일";

  /** 월간 「한 일」 절 제목(AI 가 주간 템플릿의 「주」 를 「달」 로 바꿔 쓴다). */
  static final String MONTH_DONE_SECTION = "이번 달 한 일";

  /** 개인 보고 요약 절 — 「한 일」 절이 없을 때 그 뒤에 새 절로 넣는다. */
  static final String PERSONAL_SUMMARY_SECTION = "요약";

  /** null 칸은 빈 칸 — List.of 가 null 을 받지 않아서 여기서 바꾼다(기존 표 쓰기도 null 을 빈 칸으로 썼다). */
  private static String nz(String v) {
    return v == null ? "" : v;
  }
}
