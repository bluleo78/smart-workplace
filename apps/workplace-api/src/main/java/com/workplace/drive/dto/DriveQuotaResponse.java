package com.workplace.drive.dto;

/** 드라이브 쿼터 사용량/한도 — {@code GET /api/v1/drive/quota} 응답. */
public record DriveQuotaResponse(long usedBytes, long quotaBytes) {}
