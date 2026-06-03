package com.workplace.drive.dto;

import java.time.OffsetDateTime;

/** 파일 응답. fileId 는 file core FILE.id, mimeType/sizeBytes/category 는 FILE 메타. */
public record DriveFileResponse(
    long id,
    Long folderId,
    long fileId,
    String name,
    String mimeType,
    long sizeBytes,
    String category,
    OffsetDateTime createdAt) {}
