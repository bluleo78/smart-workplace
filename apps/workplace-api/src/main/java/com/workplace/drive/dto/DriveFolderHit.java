package com.workplace.drive.dto;

import java.time.OffsetDateTime;

/** 검색 결과 폴더 항목 — DriveFolderResponse + 부모까지의 경로(folderPath). */
public record DriveFolderHit(
    long id, Long parentId, String name, OffsetDateTime createdAt, String folderPath) {}
