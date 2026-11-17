package com.workplace.wiki.report.dto;

import jakarta.validation.constraints.NotNull;

/**
 * 프로젝트 정기 리포트 저장 위치 바꾸기 요청(WP-1654) — 새 리포트를 둘 프로젝트 노트 공간의 페이지. 필수다(기본으로 되돌리려면 「리포트」 페이지를 고른다 —
 * 「최상위」는 위치가 될 수 없다).
 */
public record UpdateProjectReportLocationRequest(
    @NotNull(message = "저장 위치 페이지를 골라 주세요") Long pageId) {}
