package com.workplace.view.dto;

import java.time.Instant;

/** 사용자의 고정뷰(프로젝트 교차). 사이드바 렌더용 — projectKey 로 이동 링크 구성. */
public record PinnedSavedViewResponse(
    Long id,
    Long projectId,
    String projectKey,
    String projectName,
    String name,
    String query,
    Instant createdAt) {}
