package com.workplace.auth.service;

import com.workplace.auth.dto.ModelOption;
import java.util.List;

/**
 * Task10 — anthropic provider 의 정적 모델 목록. 프론트 {@code
 * apps/workplace-web/src/lib/assistant-models.ts} 의 MODEL_OPTIONS 를 이관(구독 OAuth 경로는 API 로 모델을 프로브할
 * 수 없어 정적 목록 사용).
 */
public final class AssistantModels {

  private AssistantModels() {}

  public static final List<ModelOption> ANTHROPIC =
      List.of(
          new ModelOption("claude-sonnet-5", "Claude Sonnet 5"),
          new ModelOption("claude-opus-4-8", "Claude Opus 4.8"),
          new ModelOption("claude-haiku-4-5", "Claude Haiku 4.5"),
          new ModelOption("claude-fable-5", "Claude Fable 5"));
}
