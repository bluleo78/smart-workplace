package com.workplace.drive.dto;

import java.time.OffsetDateTime;

/** 드라이브 파일 버전 응답(#79). current=현재(최신) 버전 여부. */
public record DriveFileVersionResponse(
    int versionNo,
    long fileId,
    long sizeBytes,
    long uploadedBy,
    String uploadedByName,
    OffsetDateTime createdAt,
    String comment,
    boolean current) {}
