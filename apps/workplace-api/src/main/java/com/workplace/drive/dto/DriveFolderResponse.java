package com.workplace.drive.dto;

import java.time.OffsetDateTime;

/** 폴더 응답. parentId NULL = 공간 루트. updatedAt 은 목록 3열(이름/크기/수정일, #799) 노출용(이름변경/이동 시 갱신). */
public record DriveFolderResponse(
    long id, Long parentId, String name, OffsetDateTime createdAt, OffsetDateTime updatedAt) {}
