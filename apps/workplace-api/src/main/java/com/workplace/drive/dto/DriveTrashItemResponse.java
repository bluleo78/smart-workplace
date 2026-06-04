package com.workplace.drive.dto;

import java.time.OffsetDateTime;

/** 휴지통 항목 — 폴더/파일 공통. type: "FOLDER"|"FILE". autoPurgeAt = trashedAt + 보존기간. */
public record DriveTrashItemResponse(
    String type,
    long id,
    String name,
    String originalPath,
    OffsetDateTime trashedAt,
    OffsetDateTime autoPurgeAt,
    Long sizeBytes) {}
