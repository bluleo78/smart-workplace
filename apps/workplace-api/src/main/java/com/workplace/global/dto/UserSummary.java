package com.workplace.global.dto;

import com.fasterxml.jackson.annotation.JsonInclude;

/**
 * 이슈 응답 내부에서 사용하는 사용자 요약. id/username/name/kind 만 노출한다. Phase 5a 에서 kind 가 추가됨 — 프론트에서 AGENT 배지 등
 * 분기에 사용한다.
 *
 * <p>active 는 「이 워크스페이스에서 활성」(WP-417 {@code WorkspaceActive})을 아는 응답만 채운다 — 지금은 이슈 담당자(WP-1080: 정지된
 * 담당자를 담당자 칸·작업 목록에서 「비활성」으로 구분). 채우지 않는 응답(null)은 JSON 에 싣지 않아 다른 화면의 응답 모양은 그대로다.
 */
public record UserSummary(
    Long id,
    String username,
    String name,
    String kind,
    @JsonInclude(JsonInclude.Include.NON_NULL) Boolean active) {

  /** 활성 여부를 모르는(싣지 않는) 요약 — 담당자 밖의 기존 사용처. */
  public UserSummary(Long id, String username, String name, String kind) {
    this(id, username, name, kind, null);
  }
}
