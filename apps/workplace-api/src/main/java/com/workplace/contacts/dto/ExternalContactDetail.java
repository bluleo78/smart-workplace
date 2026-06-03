package com.workplace.contacts.dto;

import java.time.OffsetDateTime;

/** 외부 연락처 상세. PERSONAL 은 owner 만 조회 가능(repository 에서 격리). */
public record ExternalContactDetail(
    long id,
    String name,
    String email,
    String phone,
    String organization,
    String title,
    String notes,
    String visibility,
    OffsetDateTime createdAt,
    OffsetDateTime updatedAt) {}
