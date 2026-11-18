package com.workplace.drive.dto;

import java.time.OffsetDateTime;

/**
 * 「별표」 목록 한 줄(GET /api/v1/drive/starred, WP-1698). 지금 볼 수 있는(공간 실효 멤버이고 휴지통에 없는) 항목만 온다.
 *
 * @param kind 항목 종류. FILE 또는 FOLDER
 * @param id 드라이브 파일 id 또는 폴더 id
 * @param name 파일·폴더 이름
 * @param mimeType 파일 형식(아이콘·보기 창용). 폴더면 null
 * @param sizeBytes 파일 크기. 폴더면 null
 * @param fileId 파일의 현재 버전 core file id(보기 창 재생 주소용). 폴더면 null
 * @param category 파일 분류(file.category). 폴더면 null
 * @param versionCount 파일의 총 버전 수. 폴더면 null
 * @param available 파일 원본이 저장소에 있는지(공간 폴더 목록의 available 과 같은 기준 — 없으면 다운로드·보기를 막는다). 폴더면 null
 * @param folderCount 폴더의 바로 아래 살아 있는 폴더 수. 파일이면 null
 * @param fileCount 폴더의 바로 아래 살아 있는 파일 수. 파일이면 null
 * @param parentFolderId 항목이 들어 있는 폴더 id(공간 최상위면 null) — 「파일 위치 열기」 주소용
 * @param path 공간 안 상위 폴더 경로(「/」로 이음, 최상위면 빈 문자열)
 * @param spaceId 항목이 있는 공간 id
 * @param spaceName 공간 이름(남의 개인 공간은 「○○의 드라이브」)
 * @param updatedAt 항목을 마지막으로 바꾼 시각
 * @param starredAt 별표한 시각
 */
public record DriveStarredItemResponse(
    String kind,
    long id,
    String name,
    String mimeType,
    Long sizeBytes,
    Long fileId,
    String category,
    Integer versionCount,
    Boolean available,
    Integer folderCount,
    Integer fileCount,
    Long parentFolderId,
    String path,
    long spaceId,
    String spaceName,
    OffsetDateTime updatedAt,
    OffsetDateTime starredAt) {}
