package com.workplace.wiki.report.dto;

import java.time.OffsetDateTime;

/** 그 회차의 가장 최근 보고 노트(WP-1486) — 「일일 보고 보기」와 만들기 창의 「이미 있음」 확인. */
public record PersonalReportLookupResponse(long pageId, String title, OffsetDateTime createdAt) {}
