package com.workplace.issue.report;

import com.workplace.issue.overview.status.StatusBadge;
import java.util.List;

/**
 * 리포트 한 편의 계산값(WP-1483) — 표의 모든 숫자와 배지는 시스템이 정하고 AI 는 글만 쓴다. 후처리({@code ReportMarkdown})가 이 값으로
 * 표·배지 줄을 바로잡는다.
 *
 * @param period 회차
 * @param badge 지금 배지({@code ProjectStatusRule})
 * @param previousBadge 지난 리포트 배지, 없으면 null
 * @param rows 「지난 리포트 이후」 표 행(고정 순서)
 * @param snapshot 이번 회차 스냅숏 — 회차 행에 저장한다
 * @param epics 에픽 집계(WP-1629) — AI 재료(이슈 60건 목록을 대신한다)와 일정 도표·참고 지표 표의 값
 * @param noChange 변화 없음(완료 0·새로 생김 0) — 페이지 없이 회차만 기록한다
 * @param previousFromPreviousPeriod 지난 배지가 바로 앞 기간 리포트의 것인가(WP-1629) — 아니면(건너뛴 회차가 끼었음) 진행 상태 줄이
 *     「(지난주 …)」 대신 「(지난 리포트 …)」 로 견준다. 지난 리포트가 없으면 true(견줄 배지도 없다)
 */
public record ProjectReportFacts(
    ReportPeriod period,
    StatusBadge badge,
    StatusBadge previousBadge,
    List<ReportTableRow> rows,
    ReportSnapshot snapshot,
    ProjectReportEpics epics,
    boolean noChange,
    boolean previousFromPreviousPeriod) {

  /** 지난 배지가 바로 앞 기간 리포트의 것인 계산값(기본) — 기간 비교는 호출자({@code ProjectReportGenerator})가 회차 행을 보고 정한다. */
  public ProjectReportFacts(
      ReportPeriod period,
      StatusBadge badge,
      StatusBadge previousBadge,
      List<ReportTableRow> rows,
      ReportSnapshot snapshot,
      ProjectReportEpics epics,
      boolean noChange) {
    this(period, badge, previousBadge, rows, snapshot, epics, noChange, true);
  }

  /** 지난 배지가 바로 앞 기간 리포트의 것인지만 바꾼 사본. */
  public ProjectReportFacts withPreviousFromPreviousPeriod(boolean value) {
    return new ProjectReportFacts(
        period, badge, previousBadge, rows, snapshot, epics, noChange, value);
  }
}
