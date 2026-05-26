package com.workplace.auth.controller;

import com.workplace.auth.dto.OAuthTokenMetaResponse;
import com.workplace.auth.dto.OAuthTokenRegisterRequest;
import com.workplace.auth.service.AiAgentCredentialService;
import com.workplace.global.security.RequirePermission;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Phase 5c-2 후속 (#33): AGENT OAuth 토큰 관리 — admin (user:write) 권한. 평문 토큰은 절대 응답 본문으로 반환하지 않는다 (등록 요청
 * body 와 ai-agent /me redeem 만 평문을 다룬다).
 */
@RestController
@RequestMapping("/api/v1/admin/agents/{userId}/oauth-token")
@RequiredArgsConstructor
public class AdminOAuthTokenController {

  private final AiAgentCredentialService service;

  /** 등록 (또는 재발급 — 기존 active 자동 revoke). */
  @PostMapping
  @RequirePermission("user:write")
  public ResponseEntity<OAuthTokenMetaResponse> register(
      Authentication auth,
      @PathVariable Long userId,
      @Valid @RequestBody OAuthTokenRegisterRequest req) {
    Long callerId = (Long) auth.getPrincipal();
    String trimmed = req.token().trim();
    return ResponseEntity.ok(service.register(callerId, userId, trimmed, req.label()));
  }

  /** 회수 — idempotent. */
  @DeleteMapping
  @RequirePermission("user:write")
  public ResponseEntity<Void> revoke(Authentication auth, @PathVariable Long userId) {
    Long callerId = (Long) auth.getPrincipal();
    service.revoke(callerId, userId);
    return ResponseEntity.noContent().build();
  }

  /** 메타 조회 — 평문 토큰 없음. 없으면 404. */
  @GetMapping
  @RequirePermission("user:write")
  public ResponseEntity<OAuthTokenMetaResponse> getMeta(@PathVariable Long userId) {
    return ResponseEntity.ok(service.getActiveMeta(userId));
  }
}
