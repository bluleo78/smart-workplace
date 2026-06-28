package com.workplace.drive.outbound;

// Drive 파일 업로드 커밋 후 발행되는 도메인 이벤트. 추출 파이프라인의 진입점.
public record DriveFileUploadedEvent(
    long fileId, long tenantId, String mime, String category, long sizeBytes, String storageKey) {}
