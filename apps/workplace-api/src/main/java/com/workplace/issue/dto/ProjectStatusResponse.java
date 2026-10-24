package com.workplace.issue.dto;

/** 프로젝트 상태 응답(WP-807) — 보드 컬럼·상태 고르기가 쓰는 최소 필드. color 는 색 토큰(WP-809). */
public record ProjectStatusResponse(
    Long id, String name, String category, int position, String color) {

  /** 행 → 응답. */
  public static ProjectStatusResponse from(ProjectStatusRow r) {
    return new ProjectStatusResponse(r.id(), r.name(), r.category(), r.position(), r.color());
  }
}
