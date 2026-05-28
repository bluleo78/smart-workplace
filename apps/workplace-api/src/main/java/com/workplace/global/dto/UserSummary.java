package com.workplace.global.dto;

/**
 * 이슈 응답 내부에서 사용하는 사용자 요약. id/username/name/kind 만 노출한다. Phase 5a 에서 kind 가 추가됨 — 프론트에서 AGENT 배지 등
 * 분기에 사용한다.
 */
public record UserSummary(Long id, String username, String name, String kind) {}
