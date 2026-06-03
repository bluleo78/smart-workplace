package com.workplace.drive.dto;

import java.time.OffsetDateTime;

/** 공간 응답. role 은 호출자의 공간 내 역할(OWNER/EDITOR/VIEWER). */
public record DriveSpaceResponse(
    long id, String type, String name, long ownerId, String role, OffsetDateTime createdAt) {}
