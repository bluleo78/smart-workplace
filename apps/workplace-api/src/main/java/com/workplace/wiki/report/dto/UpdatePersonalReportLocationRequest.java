package com.workplace.wiki.report.dto;

import jakarta.validation.constraints.NotNull;

/**
 * 개인 보고 저장 위치 바꾸기 요청(WP-1655) — 새 보고를 둘 내 노트(PERSONAL 공간)의 페이지. 필수다(기본으로 되돌리려면 「보고」 페이지를 고른다 —
 * 「최상위」는 위치가 될 수 없다).
 */
public record UpdatePersonalReportLocationRequest(
    @NotNull(message = "저장 위치 페이지를 골라 주세요") Long pageId) {}
