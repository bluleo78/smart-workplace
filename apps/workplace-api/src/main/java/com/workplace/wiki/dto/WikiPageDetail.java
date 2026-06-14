package com.workplace.wiki.dto;

import java.time.OffsetDateTime;

public record WikiPageDetail(
    long id,
    long spaceId,
    Long parentId,
    String title,
    String body,
    int version,
    Long updatedBy,
    OffsetDateTime updatedAt) {}
