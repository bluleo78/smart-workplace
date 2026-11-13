package com.workplace.drive.dto;

import java.time.OffsetDateTime;

/**
 * 「공유받은 항목」 한 줄(GET /api/v1/drive/shared-with-me, WP-1539). 내가 연 사내 공유 링크로 받은 파일. 공간·파일 id 는 싣지 않는다
 * — 목록 행은 권한을 주지 않고, 열기·복사는 늘 링크 토큰으로 링크 규칙(폐기·만료·비밀번호)을 거친다.
 *
 * @param shareLinkId 링크 id — 「목록에서 빼기」 대상
 * @param kind 항목 종류. 지금은 FILE 만(폴더 링크 WP-1538 이후 FOLDER 가 더해진다)
 * @param name 파일 이름
 * @param mimeType 파일 형식(아이콘용)
 * @param sizeBytes 파일 크기
 * @param spaceName 파일이 있는 공간 이름(남의 개인 공간은 「○○의 드라이브」)
 * @param sharedBy 링크를 만든 사람 이름(찾을 수 없으면 null)
 * @param lastOpenedAt 마지막으로 연 시각
 * @param openable 링크가 살아 있고 파일이 휴지통에 없으면 true — false 면 「열 수 없음」
 * @param hasPassword 비밀번호 링크면 true — 열 때 비밀번호 확인을 거친다
 * @param token 열기·복사에 쓰는 링크 토큰. 열 수 없거나 되살릴 수 없으면 null
 */
public record SharedWithMeItemResponse(
    long shareLinkId,
    String kind,
    String name,
    String mimeType,
    long sizeBytes,
    String spaceName,
    String sharedBy,
    OffsetDateTime lastOpenedAt,
    boolean openable,
    boolean hasPassword,
    String token) {}
