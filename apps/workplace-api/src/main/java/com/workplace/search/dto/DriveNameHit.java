package com.workplace.search.dto;

/**
 * 통합 검색의 드라이브 일치 한 건 — 이름 일치(WP-1353) 또는 본문만 일치한 파일(WP-1356).
 *
 * @param kind "FILE" 또는 "FOLDER"
 * @param folderId 파일이면 들어 있는 폴더, 폴더면 부모 폴더. 공간 루트 직속이면 null
 * @param mimeType 폴더면 null
 * @param folderPath 조상 폴더 이름을 " / " 로 이은 경로 — 루트 직속이면 ""
 * @param snippet 본문만 맞은 파일의 맞은 곳 발췌(한 줄, 잘린 쪽에 「…」). 이름이 맞은 결과면 null
 */
public record DriveNameHit(
    String kind,
    long id,
    long spaceId,
    String spaceName,
    Long folderId,
    String name,
    String mimeType,
    String folderPath,
    String snippet) {}
