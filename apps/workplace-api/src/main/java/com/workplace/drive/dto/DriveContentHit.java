package com.workplace.drive.dto;

/** 콘텐츠 검색 결과 1건. snippet 은 ts_headline 발췌. */
public record DriveContentHit(
    long driveFileId,
    long fileId,
    long spaceId,
    String spaceName,
    String name,
    String mimeType,
    String snippet,
    double score) {}
