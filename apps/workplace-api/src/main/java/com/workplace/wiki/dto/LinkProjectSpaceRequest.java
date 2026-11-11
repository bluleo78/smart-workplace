package com.workplace.wiki.dto;

import jakarta.validation.constraints.NotNull;

/**
 * 기존 팀 노트 공간을 프로젝트 노트 공간으로 연결하는 요청(WP-1480).
 *
 * @param spaceId 연결할 팀 공간 — 호출자가 그 공간의 OWNER 여야 한다
 */
public record LinkProjectSpaceRequest(@NotNull Long spaceId) {}
