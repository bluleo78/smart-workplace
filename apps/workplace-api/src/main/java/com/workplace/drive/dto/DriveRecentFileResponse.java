package com.workplace.drive.dto;

import java.time.OffsetDateTime;
import java.util.List;

/**
 * 「최근」 목록 한 줄(WP-1699). folderPath 는 공간 루트 → 부모 폴더 순(루트 직속이면 빈 목록), lastAction 은
 * OPEN|UPLOAD|NEW_VERSION. spaceName 은 남의 개인 공간이면 「{주인}의 드라이브」. starred 는 내가 이 파일에 별표했는지(WP-1698
 * 별표) — 「최근」 행의 별표 단추가 켜진 모양을 정한다. fileId 는 지금 버전의 core 파일 id(공간 목록 DriveFileResponse.fileId 와 같은
 * 뜻) — 웹 뷰어의 재생 주소 캐시 키에 들어가 새 버전이 올라오면 키가 바뀐다(WP-1699 리뷰).
 */
public record DriveRecentFileResponse(
    long driveFileId,
    long fileId,
    String name,
    String mimeType,
    long sizeBytes,
    long spaceId,
    String spaceName,
    Long folderId,
    List<DriveFolderPathSegment> folderPath,
    String lastAction,
    OffsetDateTime lastAt,
    boolean starred) {}
