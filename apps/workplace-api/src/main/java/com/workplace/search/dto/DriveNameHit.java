package com.workplace.search.dto;

/**
 * 통합 검색의 드라이브 이름 일치 한 건(WP-1353).
 *
 * @param kind "FILE" 또는 "FOLDER"
 * @param folderId 파일이면 들어 있는 폴더, 폴더면 부모 폴더. 공간 루트 직속이면 null
 * @param mimeType 폴더면 null
 * @param folderPath 조상 폴더 이름을 " / " 로 이은 경로 — 루트 직속이면 ""
 */
public record DriveNameHit(
    String kind,
    long id,
    long spaceId,
    String spaceName,
    Long folderId,
    String name,
    String mimeType,
    String folderPath) {}
