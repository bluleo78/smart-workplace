package com.workplace.contacts.dto;

import java.time.OffsetDateTime;

/** 외부 연락처 상세. editable = caller==owner || ADMIN (서버 계산, 프론트 버튼 게이팅). isFavorite = 호출자 기준 즐겨찾기. */
public record ExternalContactDetail(
    long id,
    String name,
    String email,
    String phone,
    String organization,
    String title,
    String notes,
    String visibility,
    boolean editable,
    boolean isFavorite,
    OffsetDateTime createdAt,
    OffsetDateTime updatedAt) {}
