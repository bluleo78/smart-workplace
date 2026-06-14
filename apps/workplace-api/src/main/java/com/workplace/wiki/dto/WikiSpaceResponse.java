package com.workplace.wiki.dto;

import java.time.OffsetDateTime;

public record WikiSpaceResponse(
    long id, String type, String name, long ownerId, String role, OffsetDateTime createdAt) {}
