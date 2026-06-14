package com.workplace.wiki.dto;

/** 본문 토큰 1개의 하이드레이션 결과(칩 라벨/링크용). 비가시 대상은 목록에서 제외. */
public record WikiMentionRef(
    String type, // USER | PAGE | ISSUE
    long id, // 대상 전역 id
    String label, // 유저 name / 페이지 title / 이슈 title
    Long spaceId, // PAGE 전용 라우트(그 외 null)
    String projectKey, // ISSUE 전용(그 외 null)
    Integer number) {} // ISSUE 전용(그 외 null)
