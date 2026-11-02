package com.workplace.agentruntime.controller;

import com.workplace.agentruntime.dto.AgentRepoCredentialRequest;
import com.workplace.agentruntime.dto.AgentRepoCredentialResponse;
import com.workplace.agentruntime.service.AgentRepoCredentialService;
import com.workplace.auth.service.AiAgentCredentialService;
import com.workplace.global.security.RequireAdmin;
import com.workplace.global.security.RequirePermission;
import com.workplace.global.security.RequireWebSession;
import com.workplace.user.service.WorkspaceMemberGuard;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
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
 * AI 별 저장소 토큰 관리(WP-1268) — 관리자(user:write) 전용. 가드는 AI 프로바이더 연결 관리({@code
 * AdminProviderCredentialController})와 같다. 토큰은 등록 요청 body 에만 실리고 어떤 응답에도 나오지 않는다.
 */
@RestController
@RequestMapping("/api/v1/admin/agents/{userId}/repo-credentials")
@RequiredArgsConstructor
// AI 관리는 ADMIN 만(WP-729) — AI 연결과 같은 이유로 저장소 토큰도 일반 구성원이 넣지 못하게 한다.
@RequireAdmin
public class AdminAgentRepoCredentialController {

  private final AgentRepoCredentialService service;
  private final AiAgentCredentialService agentCredentials;
  private final WorkspaceMemberGuard memberGuard;

  /** 활성 토큰 메타(host 오름차순) — 토큰 없음. */
  @GetMapping
  @RequirePermission("user:write")
  public ResponseEntity<List<AgentRepoCredentialResponse>> list(@PathVariable Long userId) {
    memberGuard.require(userId);
    return ResponseEntity.ok(service.list(userId));
  }

  /** 등록·교체 — 같은 host 의 활성 토큰은 폐기되고 새 토큰이 활성이 된다. */
  @PostMapping
  @RequireWebSession
  @RequirePermission("user:write")
  public ResponseEntity<AgentRepoCredentialResponse> register(
      Authentication auth, @PathVariable Long userId, @RequestBody AgentRepoCredentialRequest req) {
    Long callerId = (Long) auth.getPrincipal();
    // 다른 워크스페이스의 AI 는 없는 것과 같다(404), AI 가 아니면 400, 개인 비서는 403 — AI 연결 등록과 같은 검사(WP-703·WP-1170).
    memberGuard.require(userId);
    agentCredentials.assertAdminMayConfigure(userId);
    return ResponseEntity.status(HttpStatus.CREATED).body(service.register(callerId, userId, req));
  }

  /** 폐기 — 그 AI 의 활성 토큰이 아니면 404. */
  @DeleteMapping("/{credentialId}")
  @RequireWebSession
  @RequirePermission("user:write")
  public ResponseEntity<Void> revoke(
      Authentication auth, @PathVariable Long userId, @PathVariable Long credentialId) {
    memberGuard.require(userId);
    service.revoke((Long) auth.getPrincipal(), userId, credentialId);
    return ResponseEntity.noContent().build();
  }
}
