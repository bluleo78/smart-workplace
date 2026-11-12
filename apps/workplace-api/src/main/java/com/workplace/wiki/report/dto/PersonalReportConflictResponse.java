package com.workplace.wiki.report.dto;

import com.fasterxml.jackson.annotation.JsonInclude;

/**
 * 「보고서 만들기」 409 본문(WP-1486) — 화면이 code 로 가른다. 코드마다 실을 값이 달라 빈 칸은 내보내지 않는다.
 *
 * <ul>
 *   <li>{@code NO_ASSISTANT} — message 만
 *   <li>{@code REPORT_EXISTS} — 이미 있는 노트 pageId·title(「이미 있음 — {제목}」·열기/새로 만들기)
 *   <li>{@code REPORT_IN_PROGRESS} — 만드는 중인 회차 id(그 회차를 폴링)
 * </ul>
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record PersonalReportConflictResponse(
    String code, String message, Long id, Long pageId, String title) {}
