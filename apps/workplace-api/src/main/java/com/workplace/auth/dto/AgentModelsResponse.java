package com.workplace.auth.dto;

import java.util.List;

/**
 * Task10 — 저장된 자격증명 기준 모델 목록. anthropic 은 정적 목록, opencode 는 저장된 payload 로 실시간 프로브(id 에 {@code
 * providerId/} 접두 부여).
 */
public record AgentModelsResponse(String provider, List<ModelOption> models) {}
