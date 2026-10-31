package com.workplace.agentruntime.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.util.Map;

/**
 * AI 실행 설정 저장 요청(WP-1247).
 *
 * @param templateName 작업 공간 템플릿 이름(예: claude-code)
 * @param locationId 실행 위치(null = 워크스페이스 기본 위치)
 * @param config 템플릿 설정 칸 값(빈 칸은 템플릿 기본값으로 채운다)
 * @param applyMode 바뀐 설정을 언제 적용할지(없으면 IDLE — 쉴 때 적용)
 */
public record PutAgentRuntimeSettingRequest(
    @NotBlank(message = "실행 템플릿을 골라 주세요") @Size(max = 64, message = "실행 템플릿 이름이 너무 깁니다")
        String templateName,
    Long locationId,
    Map<String, String> config,
    ApplyMode applyMode) {}
