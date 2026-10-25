package com.workplace.component.dto;

import java.time.Instant;

/** project_component 한 행(저장소 → 서비스 내부 전달용). 외부 응답에는 {@link ComponentResponse} 를 쓴다. */
public record ComponentRow(
    long id,
    long projectId,
    String name,
    String description,
    Long defaultAssigneeId,
    Instant archivedAt,
    Long createdBy,
    Instant createdAt,
    Instant updatedAt) {

  /** 보관 여부 — archived_at 이 있으면 보관됨. */
  public boolean archived() {
    return archivedAt != null;
  }

  /** 이슈 응답·이력에 싣는 요약(id·이름·보관 여부). */
  public ComponentSummary toSummary() {
    return new ComponentSummary(id, name, archived());
  }
}
