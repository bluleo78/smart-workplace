package com.workplace.wiki.report.dto;

/**
 * 수동 보고 회차 상태(WP-1486) — 만들기 창이 3초마다 묻는다.
 *
 * @param status PENDING(만드는 중) · GENERATED · SKIPPED · FAILED
 * @param pageId 만든 노트(없으면 null)
 * @param title 만든 노트 제목(없으면 null)
 * @param error 실패 문구(FAILED 일 때)
 */
public record PersonalReportStatusResponse(
    long id, String status, Long pageId, String title, String error) {}
