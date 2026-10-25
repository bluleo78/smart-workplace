package com.workplace.issue.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/**
 * 사용자 정의 관계 유형 추가·편집 요청. 방향 있는 유형이면 {@code inwardLabel} 이 필수이고, 방향 없는 유형이면 무시한다(NULL 로 저장).
 *
 * @param outwardLabel A 쪽 말(방향 없으면 유일한 말)
 * @param inwardLabel B 쪽 말
 */
public record SaveIssueRelationTypeRequest(
    @NotBlank @Size(max = 30) String name,
    boolean directed,
    @NotBlank @Size(max = 30) String outwardLabel,
    @Size(max = 30) String inwardLabel) {}
