package com.workplace.version.dto;

import java.time.LocalDate;
import java.time.OffsetDateTime;

/** project_version 한 행(저장소 → 서비스 내부 전달용). 외부 응답에는 {@link VersionResponse} 를 쓴다. */
public record VersionRow(
    long id,
    long projectId,
    String name,
    String description,
    LocalDate startDate,
    LocalDate releaseDate,
    OffsetDateTime releasedAt,
    OffsetDateTime archivedAt,
    Long createdBy,
    OffsetDateTime createdAt,
    OffsetDateTime updatedAt) {

  public static final String UNRELEASED = "UNRELEASED";
  public static final String RELEASED = "RELEASED";
  public static final String ARCHIVED = "ARCHIVED";

  /** 보관 여부 — archived_at 이 있으면 보관됨. */
  public boolean archived() {
    return archivedAt != null;
  }

  /** 상태 — 보관(archived_at) &gt; 출시됨(released_at) &gt; 미출시. 보관은 출시 시각을 건드리지 않아 복원하면 이전 상태로 돌아간다. */
  public String status() {
    if (archivedAt != null) return ARCHIVED;
    return releasedAt != null ? RELEASED : UNRELEASED;
  }

  /** 이슈 응답·이력에 싣는 요약. */
  public VersionSummary toSummary() {
    return new VersionSummary(id, name, status());
  }
}
