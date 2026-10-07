package com.workplace.wiki.dto;

import java.time.OffsetDateTime;

public record WikiPageDetail(
    long id,
    long spaceId,
    Long parentId,
    String title,
    String body,
    int version,
    Long updatedBy,
    OffsetDateTime updatedAt,
    // #736: 페이지 단위 AI 생성 attribution — 마지막 AI 스트림 사용 시각/액션. 둘 다 null 이면 AI 이력 없음.
    OffsetDateTime aiLastUsedAt,
    String aiLastAction) {

  /** 본문·version 만 바꾼 사본 — 동기화 서버 위임 저장의 응답(저장된 body·version + 나머지는 재조회 값). */
  public WikiPageDetail withBody(String newBody, int newVersion) {
    return new WikiPageDetail(
        id,
        spaceId,
        parentId,
        title,
        newBody,
        newVersion,
        updatedBy,
        updatedAt,
        aiLastUsedAt,
        aiLastAction);
  }
}
