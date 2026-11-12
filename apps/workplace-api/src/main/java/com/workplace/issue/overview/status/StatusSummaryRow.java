package com.workplace.issue.overview.status;

import java.time.OffsetDateTime;

/**
 * 프로젝트 상태 요약 한 행(WP-1479). badge·summary·inputHash·generatedAt 은 아직 한 번도 만들지 않았으면 null 이고,
 * nextRunAt 이 null 이면 즉시 점검 대상이다.
 */
public record StatusSummaryRow(
    long projectId,
    String badge,
    String summary,
    String inputHash,
    OffsetDateTime generatedAt,
    OffsetDateTime checkedAt,
    OffsetDateTime nextRunAt) {}
