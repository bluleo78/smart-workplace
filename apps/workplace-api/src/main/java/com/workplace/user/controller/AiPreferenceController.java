package com.workplace.user.controller;

import com.workplace.user.dto.AiPreferencesResponse;
import com.workplace.user.dto.UpdateAiPreferencesRequest;
import com.workplace.user.service.AiPreferenceService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

/**
 * 본인 AI 사용 설정(WP-139·WP-55). 권한 체크 없음 — 누구나 자기 설정만 바꾼다(MyAssistantController 와 같은 self-service).
 */
@RestController
@RequestMapping("/api/v1/users/me/ai-preferences")
@RequiredArgsConstructor
public class AiPreferenceController {

  private final AiPreferenceService service;

  /** 현재 설정. */
  @GetMapping
  public AiPreferencesResponse get(@AuthenticationPrincipal Long callerId) {
    return current(callerId);
  }

  /** 부분 저장 후 두 값을 다시 읽어 돌려준다 — 웹이 응답을 그대로 캐시에 넣으므로 요청에 없던 값도 실제 값이어야 한다(판정 3). */
  @PutMapping
  public AiPreferencesResponse update(
      @AuthenticationPrincipal Long callerId, @RequestBody UpdateAiPreferencesRequest req) {
    if (req.suggestionsEnabled() == null && req.memoryEnabled() == null) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "바꿀 설정이 없어요");
    }
    service.update(callerId, req.suggestionsEnabled(), req.memoryEnabled());
    return current(callerId);
  }

  private AiPreferencesResponse current(long callerId) {
    return new AiPreferencesResponse(
        service.suggestionsEnabled(callerId), service.memoryEnabled(callerId));
  }
}
