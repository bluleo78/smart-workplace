package com.workplace.auth.controller;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.auth.dto.AssistantStatusResponse;
import com.workplace.auth.dto.RegisterAssistantCredentialRequest;
import com.workplace.auth.dto.UpdateAssistantNameRequest;
import com.workplace.auth.dto.UpdateAssistantSettingsRequest;
import com.workplace.auth.service.PersonalAssistantService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 로그인한 본인의 개인 비서 self-service 엔드포인트. 권한 체크 없음(누구나 자기 비서만 관리) — callerId 는 인증 principal(Long) 에서
 * 가져온다.
 */
@RestController
@RequestMapping("/api/v1/users/me/assistant")
@RequiredArgsConstructor
public class MyAssistantController {

  private final PersonalAssistantService service;
  private final ObjectMapper objectMapper;

  /** 개인 비서 상태 조회(미설정이면 configured=false). */
  @GetMapping
  public AssistantStatusResponse status(@AuthenticationPrincipal Long callerId) {
    return service.getStatus(callerId);
  }

  /**
   * 자격증명 등록/교체 — 최초 등록 시 개인 AGENT 자동 생성. provider 생략 시 anthropic(하위호환). anthropic 은 token, opencode
   * 는 providerConfig(+model 필수)를 사용하며 형태 검증은 서비스 계층에서 수행한다.
   */
  @PutMapping("/credential")
  public ResponseEntity<Void> registerCredential(
      @AuthenticationPrincipal Long callerId,
      @Valid @RequestBody RegisterAssistantCredentialRequest req) {
    String provider = ProviderCredentialSecrets.resolveProvider(req.provider());
    String secret =
        ProviderCredentialSecrets.resolveSecret(
            objectMapper, provider, req.token(), req.providerConfig());
    service.registerCredential(callerId, provider, secret, req.label(), req.model());
    return ResponseEntity.noContent().build();
  }

  /** 모델/생각 깊이 변경(null = 디폴트로 되돌림). */
  @PutMapping("/settings")
  public ResponseEntity<Void> updateSettings(
      @AuthenticationPrincipal Long callerId,
      @Valid @RequestBody UpdateAssistantSettingsRequest req) {
    service.updateSettings(callerId, req.model(), req.thinkingDepth());
    return ResponseEntity.noContent().build();
  }

  /** 개인 비서 표시 이름 변경 — 본인만(설정/모델과 분리된 전용 엔드포인트). */
  @PutMapping("/name")
  public ResponseEntity<Void> updateName(
      @AuthenticationPrincipal Long callerId, @Valid @RequestBody UpdateAssistantNameRequest req) {
    service.updateName(callerId, req.name());
    return ResponseEntity.noContent().build();
  }

  /** 개인 비서 해제(토큰 revoke + FK null). */
  @DeleteMapping
  public ResponseEntity<Void> disable(@AuthenticationPrincipal Long callerId) {
    service.disable(callerId);
    return ResponseEntity.noContent().build();
  }
}
