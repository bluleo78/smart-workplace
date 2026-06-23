package com.workplace.project.dto;

import java.time.Instant;
import java.util.List;

/** 프로젝트 API 응답 DTO. */
public record ProjectResponse(
    Long id,
    String key,
    String name,
    String description,
    Long ownerId,
    String type,
    boolean isDefault,
    Instant createdAt,
    Instant updatedAt,
    int issueTotal, // 분모(전체 − CANCELED)
    int issueDone, // DONE 개수
    int memberCount, // 멤버 수(멤버 없으면 소유자 1명으로 폴백)
    List<String> memberNames) { // 상위 3명 이름(프론트가 이니셜·해시색 도출)

  /** 집계 없는 단건 응답(상세/생성 등) — 카운트 0/빈값. */
  public static ProjectResponse from(ProjectRow row) {
    return from(row, 0, 0, 0, List.of());
  }

  /** 목록 응답 — 이슈 진행률/멤버 집계 포함. */
  public static ProjectResponse from(
      ProjectRow row, int issueTotal, int issueDone, int memberCount, List<String> memberNames) {
    return new ProjectResponse(
        row.id(),
        row.key(),
        row.name(),
        row.description(),
        row.ownerId(),
        row.type(),
        row.isDefault(),
        row.createdAt(),
        row.updatedAt(),
        issueTotal,
        issueDone,
        memberCount,
        memberNames);
  }
}
