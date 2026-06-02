package com.workplace.view.dto;

import java.time.Instant;

/** 저장된 뷰 응답. mine = 호출자가 owner 인지(프론트 수정/삭제 메뉴 노출용). */
public record SavedViewResponse(
    Long id,
    String name,
    String query,
    String visibility,
    Long ownerId,
    boolean mine,
    boolean pinned,
    Instant createdAt,
    Instant updatedAt) {}
