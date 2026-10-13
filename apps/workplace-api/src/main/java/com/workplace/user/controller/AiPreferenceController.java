package com.workplace.user.controller;

import com.workplace.user.dto.AiPreferencesResponse;
import com.workplace.user.dto.UpdateAiPreferencesRequest;
import com.workplace.user.service.AiPreferenceService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** 본인 AI 사용 설정(WP-139). 권한 체크 없음 — 누구나 자기 설정만 바꾼다(MyAssistantController 와 같은 self-service). */
@RestController
@RequestMapping("/api/v1/users/me/ai-preferences")
@RequiredArgsConstructor
public class AiPreferenceController {

  private final AiPreferenceService service;

  /** 현재 설정. */
  @GetMapping
  public AiPreferencesResponse get(@AuthenticationPrincipal Long callerId) {
    return new AiPreferencesResponse(service.suggestionsEnabled(callerId));
  }

  /** 저장 후 저장된 값을 돌려준다 — 웹이 그대로 캐시에 넣는다. */
  @PutMapping
  public AiPreferencesResponse update(
      @AuthenticationPrincipal Long callerId, @Valid @RequestBody UpdateAiPreferencesRequest req) {
    service.update(callerId, req.suggestionsEnabled());
    return new AiPreferencesResponse(service.suggestionsEnabled(callerId));
  }
}
