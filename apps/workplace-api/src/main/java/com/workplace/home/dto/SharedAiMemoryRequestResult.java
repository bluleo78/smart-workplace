package com.workplace.home.dto;

/** 직접 요청 결과 — changeId 는 채팅 결과 줄 「되돌리기」가 되돌릴 기록. spaceName 은 라벨. */
public record SharedAiMemoryRequestResult(
    long changeId,
    long memoryId,
    String spaceType,
    Long spaceId,
    String spaceName,
    String content) {}
