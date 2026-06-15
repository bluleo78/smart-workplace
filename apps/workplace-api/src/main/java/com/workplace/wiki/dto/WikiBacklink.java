package com.workplace.wiki.dto;

import java.time.OffsetDateTime;

/** 이 페이지를 참조하는 source 페이지 1개. */
public record WikiBacklink(
    long pageId, long spaceId, String spaceName, String title, OffsetDateTime updatedAt) {}
