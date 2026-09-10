package com.workplace.drive.dto;

import java.time.OffsetDateTime;

/** 검색 결과 파일 항목 — DriveFileResponse + 조상 폴더 경로(folderPath). updatedAt 은 목록 3열(#799)용. */
public record DriveFileHit(
    long id,
    Long folderId,
    long fileId,
    String name,
    String mimeType,
    long sizeBytes,
    String category,
    OffsetDateTime createdAt,
    OffsetDateTime updatedAt,
    String folderPath) {}
