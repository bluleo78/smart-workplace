package com.workplace.messaging.dto;

import java.time.OffsetDateTime;

/**
 * 제안 승인 요청. 이슈: projectKey(드롭다운 override). 일정: 편집 가능 카드에서 위임자가 수정한 title·startsAt·endsAt·location.
 * 모든 필드 null 가능(미수정이면 제안 저장값 사용). 참석자는 이번 슬라이스 범위 밖.
 */
public record ConfirmProposalRequest(
    String projectKey,
    String title,
    OffsetDateTime startsAt,
    OffsetDateTime endsAt,
    String location) {}
