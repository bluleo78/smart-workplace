package com.workplace.wiki.report.dto;

import java.time.LocalDate;

/**
 * 「지난 리포트」 목록 한 줄(WP-1483). 배지는 생성 때 저장한 값이다 — 목록을 그리려고 본문을 열 번 읽지 않는다.
 *
 * @param title 페이지의 지금 제목
 * @param badge ON_TRACK|WARN|RISK, 저장값이 없으면 null
 * @param edited AI 가 쓴 뒤 사람이 고쳤는지
 */
public record ReportListItem(
    long pageId, String title, LocalDate periodStart, String badge, boolean edited) {}
