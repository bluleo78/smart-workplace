package com.workplace.wiki.report.dto;

/**
 * 「지금 생성」 응답(WP-1630) — 만든(또는 새 판을 쓴) 리포트 페이지.
 *
 * @param pageId 리포트 노트 페이지 id
 * @param title 페이지 제목(예: 「11월 3주차 주간 리포트」)
 * @param replaced 같은 회차 리포트가 이미 있어 그 페이지에 새 판을 썼으면 true(직전 판은 수정 기록에)
 */
public record ProjectReportGenerateResponse(long pageId, String title, boolean replaced) {}
