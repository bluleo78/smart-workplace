package com.workplace.auth.controller;

import com.workplace.auth.dto.AgentApiKeyIssueResponse;
import com.workplace.auth.dto.AgentApiKeyResponse;
import com.workplace.auth.dto.IssueAgentKeyRequest;
import com.workplace.auth.service.AgentApiKeyService;
import com.workplace.global.security.RequirePermission;
import jakarta.validation.Valid;
import java.util.List;
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

/** Phase 5a — AGENT 별 API 키 발급/조회/회수. ADMIN(user:write) 권한 필요. */
@RestController
@RequestMapping("/api/v1/admin/agents/{userId}/keys")
@RequiredArgsConstructor
public class AdminAgentKeyController {

  private final AgentApiKeyService service;

  /** 키 목록 (평문/해시 제외). */
  @GetMapping
  @RequirePermission("user:write")
  public ResponseEntity<List<AgentApiKeyResponse>> list(@PathVariable Long userId) {
    return ResponseEntity.ok(service.list(userId));
  }

  /** 키 발급 — 응답의 plaintextKey 는 1회만 표시된다. */
  @PostMapping
  @RequirePermission("user:write")
  public ResponseEntity<AgentApiKeyIssueResponse> issue(
      Authentication auth,
      @PathVariable Long userId,
      @Valid @RequestBody IssueAgentKeyRequest req) {
    Long callerId = (Long) auth.getPrincipal();
    return ResponseEntity.ok(service.issue(callerId, userId, req));
  }

  /** 키 회수. */
  @DeleteMapping("/{keyId}")
  @RequirePermission("user:write")
  public ResponseEntity<Void> revoke(
      Authentication auth, @PathVariable Long userId, @PathVariable Long keyId) {
    Long callerId = (Long) auth.getPrincipal();
    service.revoke(callerId, userId, keyId);
    return ResponseEntity.noContent().build();
  }
}
