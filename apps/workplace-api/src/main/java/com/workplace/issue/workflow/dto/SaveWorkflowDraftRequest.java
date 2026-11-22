package com.workplace.issue.workflow.dto;

import com.workplace.global.time.SupportedDateTime;
import jakarta.validation.constraints.NotNull;
import java.time.Instant;

/**
 * 초안 저장 요청.
 *
 * @param expectedDraftUpdatedAt 편집을 시작할 때 본 초안 시각(밀리초로 비교, null 이면 충돌 검사 생략)
 */
public record SaveWorkflowDraftRequest(
    @NotNull(message = "YAML 내용을 보내 주세요") @StorableText String yaml,
    @SupportedDateTime Instant expectedDraftUpdatedAt) {}
