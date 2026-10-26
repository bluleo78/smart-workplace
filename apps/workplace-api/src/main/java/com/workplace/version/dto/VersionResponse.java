package com.workplace.version.dto;

import java.time.LocalDate;
import java.time.OffsetDateTime;

/**
 * 버전 목록·상세 응답. status 는 UNRELEASED|RELEASED|ARCHIVED(보관 &gt; 출시됨 &gt; 미출시), progress 는 수정 버전 이슈의
 * 진행, affectsCount 는 영향 버전으로 붙은 이슈 수(취소 포함).
 */
public record VersionResponse(
    long id,
    String name,
    String description,
    LocalDate startDate,
    LocalDate releaseDate,
    String status,
    OffsetDateTime releasedAt,
    VersionProgress progress,
    int affectsCount) {}
