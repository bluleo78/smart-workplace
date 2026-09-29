package com.workplace.auth.service;

import com.workplace.auth.dto.ModelOption;
import java.util.List;

/**
 * anthropic provider 의 정적 모델 목록 — #873 부터는 Anthropic Models API 실시간 조회 실패 시에만 쓰는 폴백. id 는 실시간 조회
 * 응답과 동일한 식별자로 맞춰(haiku 는 dated id) 폴백↔실시간 전환 시 선택값이 어긋나지 않게 한다.
 */
public final class AssistantModels {

  private AssistantModels() {}

  public static final List<ModelOption> ANTHROPIC =
      List.of(
          new ModelOption("claude-sonnet-5-5", "Claude Sonnet 5.5"),
          new ModelOption("claude-opus-5-5", "Claude Opus 5.5"),
          new ModelOption("claude-fable-5-1", "Claude Fable 5.1"),
          new ModelOption("claude-haiku-4-5-20251001", "Claude Haiku 4.5"));
}
