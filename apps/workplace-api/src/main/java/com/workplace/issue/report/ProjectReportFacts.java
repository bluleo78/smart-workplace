package com.workplace.issue.report;

import com.workplace.issue.overview.status.StatusBadge;
import java.util.List;
import java.util.Map;

/**
 * 리포트 한 편의 계산값(WP-1483) — 표의 모든 숫자와 배지는 시스템이 정하고 AI 는 글만 쓴다. 후처리({@code ReportMarkdown})가 이 값으로
 * 표·배지 줄을 바로잡는다.
 *
 * @param period 회차
 * @param badge 지금 배지({@code ProjectStatusRule})
 * @param previousBadge 지난 리포트 배지, 없으면 null
 * @param rows 「지난 리포트 이후」 표 행(고정 순서)
 * @param snapshot 이번 회차 스냅숏 — 회차 행에 저장한다
 * @param issues 기간 이슈 목록(최대 60건)
 * @param omittedByEpic 상한 밖으로 밀린 이슈의 에픽 제목 → 건수(많은 순)
 * @param noChange 변화 없음(완료 0·새로 생김 0) — 페이지 없이 회차만 기록한다
 */
public record ProjectReportFacts(
    ReportPeriod period,
    StatusBadge badge,
    StatusBadge previousBadge,
    List<ReportTableRow> rows,
    ReportSnapshot snapshot,
    List<ReportIssue> issues,
    Map<String, Integer> omittedByEpic,
    boolean noChange) {}
