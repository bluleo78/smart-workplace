package com.workplace.wiki.dto;

import java.time.OffsetDateTime;

/**
 * 노트 공간 한 줄(목록·단건).
 *
 * @param role 호출자 실효 역할(직접 + 조직도 부서 중 가장 높은 것)
 * @param projectKey 프로젝트 노트 공간이면 연결된 프로젝트 key, 아니면 null(WP-1480) — 노트 앱이 프로젝트 공간을 알아보고 멤버 편집을 프로젝트
 *     설정으로 안내하게 한다. 기존 필드 순서를 지키려고 맨 뒤에 둔다.
 */
public record WikiSpaceResponse(
    long id,
    String type,
    String name,
    long ownerId,
    String role,
    OffsetDateTime createdAt,
    String projectKey) {}
