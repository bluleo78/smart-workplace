package com.workplace.issue.workflow.dto;

import com.workplace.global.time.SupportedDateTime;
import java.time.Instant;

/**
 * 게시 선택 본문(본문 자체가 없어도 된다).
 *
 * @param expectedDraftUpdatedAt 게시하려고 본 초안의 시각(밀리초로 비교, null 이면 충돌 검사 생략)
 * @param enable true 면 게시와 함께 켠다(이미 켜져 있으면 그대로, null·false 면 켜짐 상태를 건드리지 않는다)
 */
public record PublishWorkflowRequest(
    @SupportedDateTime Instant expectedDraftUpdatedAt, Boolean enable) {}
