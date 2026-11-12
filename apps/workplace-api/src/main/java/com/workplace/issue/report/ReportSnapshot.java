package com.workplace.issue.report;

/**
 * 리포트 한 회차의 숫자 스냅숏(WP-1483) — 회차 행에 저장해 두고 다음 리포트의 「열린 이슈」「기한 지남」 변화와 지난 배지를 계산할 때 읽는다.
 *
 * @param completed 그 회차 완료 수
 * @param created 그 회차 새로 생김 수
 * @param openIssues 만든 시각의 열린 이슈 수
 * @param overdue 만든 시각의 기한 지남 수
 * @param badge 그 회차 배지 이름(ON_TRACK / WARN / RISK). 모르면 null
 */
public record ReportSnapshot(
    int completed, int created, int openIssues, int overdue, String badge) {}
