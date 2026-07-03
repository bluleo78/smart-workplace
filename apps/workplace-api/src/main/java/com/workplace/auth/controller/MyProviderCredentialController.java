package com.workplace.auth.controller;

import com.workplace.auth.dto.ProviderCredentialRedeemResponse;
import com.workplace.auth.service.AiAgentCredentialService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Phase 5c-2 후속 (#33), 멀티 프로바이더(#opencode) 확장: AGENT 본인이 자기 프로바이더 자격증명을 redeem. API key 인증으로만 접근
 * 가능(ApiKeyAuthenticationFilter 가 AGENT user 의 id 를 principal 로 설정). HUMAN 호출은
 * KeyTargetMustBeAgentException (400) 으로 차단된다 — 자격증명 존재 여부 누설 방지.
 */
@RestController
@RequestMapping("/api/v1/users/me/provider-credential")
@RequiredArgsConstructor
public class MyProviderCredentialController {

  private final AiAgentCredentialService service;

  @GetMapping
  public ResponseEntity<ProviderCredentialRedeemResponse> redeem(Authentication auth) {
    Long callerId = (Long) auth.getPrincipal();
    return ResponseEntity.ok(service.redeemSelf(callerId));
  }
}
