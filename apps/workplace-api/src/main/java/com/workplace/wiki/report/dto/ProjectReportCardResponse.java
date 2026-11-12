package com.workplace.wiki.report.dto;

import java.util.List;

/**
 * 개요 카드 리포트 줄 응답(WP-1483) — {@code GET /api/v1/projects/{key}/reports}. 노트 공간 멤버가 아니거나 리포트가 없으면
 * latest=null, past=[] 이다(화면은 줄을 그리지 않는다).
 *
 * @param latest 최신 리포트(없으면 null)
 * @param past 최신 회차부터 최대 10개(최신 포함 — 드롭다운이 「이번 회차」로 표시), 지워졌거나 공간 밖으로 옮겨진 페이지는 뺀다
 * @param reportsPageId 「리포트」 노트 페이지(「노트에서 모두 보기」), 없으면 null
 * @param cadenceLabel 최신 리포트의 주기 이름 주간|격주|월간(줄 머리 「주간 리포트」), 최신이 없으면 null
 */
public record ProjectReportCardResponse(
    ReportCard latest, List<ReportListItem> past, Long reportsPageId, String cadenceLabel) {

  /** 보일 리포트가 없는 응답. */
  public static ProjectReportCardResponse empty() {
    return new ProjectReportCardResponse(null, List.of(), null, null);
  }
}
