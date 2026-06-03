package com.workplace.drive.dto;

import java.time.OffsetDateTime;

/** 폴더 응답. parentId NULL = 공간 루트. */
public record DriveFolderResponse(long id, Long parentId, String name, OffsetDateTime createdAt) {}
