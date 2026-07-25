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
    int versionCount,
    // 컬럼 아님 — 조회 시점에 FileStore.exists() 로 계산되는 파생 필드(원본 blob 유실 가시화, #739).
    // 플래그를 두지 않는 이유는 설계 문서 참조: 로컬 디스크 stat 비용이 무시할 수준이라 캐시/컬럼화의
    // 불일치 위험을 감수할 이유가 없다.
    boolean available) {}
