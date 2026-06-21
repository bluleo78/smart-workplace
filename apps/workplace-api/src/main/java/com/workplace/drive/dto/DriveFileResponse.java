package com.workplace.drive.dto;

import java.time.OffsetDateTime;

/**
 * 파일 응답. fileId 는 file core FILE.id, mimeType/sizeBytes/category 는 FILE 메타. versionCount 는 총 버전
 * 수(#79).
 */
public record DriveFileResponse(
    long id,
    Long folderId,
    long fileId,
    String name,
    String mimeType,
    long sizeBytes,
    String category,
    OffsetDateTime createdAt,
    int versionCount) {}
