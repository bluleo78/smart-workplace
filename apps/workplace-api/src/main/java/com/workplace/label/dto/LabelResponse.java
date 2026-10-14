package com.workplace.label.dto;

import java.time.Instant;

/** 라벨 단건 응답 DTO. viewerCanManage — 요청자가 이 라벨을 수정·삭제할 수 있는지(OWNER·ADMIN 또는 만든 멤버, WP-394). */
public record LabelResponse(
    Long id,
    Long projectId,
    String name,
    String colorToken,
    Instant createdAt,
    Instant updatedAt,
    boolean viewerCanManage) {}
