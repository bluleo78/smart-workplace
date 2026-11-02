package com.workplace.agentruntime.controller;

import com.workplace.agentruntime.dto.AgentScreenSessionResponse;
import com.workplace.agentruntime.screen.AgentScreenService;
import com.workplace.global.security.RequireAdmin;
import com.workplace.global.security.RequirePermission;
import lombok.RequiredArgsConstructor;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * AI 작업 화면 열기 API(WP-1277) — 실행 중인 AI 의 터미널을 관리자 화면에서 보려고 세션과 일회용 접속 표를 받는다. AI 관리는 ADMIN 만(다른 실행
 * 설정 API 와 같은 기준). 이어지는 WebSocket 은 {@code AgentScreenWebSocketConfig}.
 */
@RestController
@RequestMapping("/api/v1/admin/agents/{agentUserId}/screen-sessions")
@RequiredArgsConstructor
@RequireAdmin
public class AdminAgentScreenController {

  private final AgentScreenService service;

  /** 작업 화면 세션 열기 — 201 {sessionId, ticket, expiresAt}. 실행 중이 아니거나 이미 3개 열려 있으면 409. 표가 실려 캐시 금지. */
  @PostMapping
  @RequirePermission("user:write")
  public ResponseEntity<AgentScreenSessionResponse> open(
      Authentication auth, @PathVariable long agentUserId) {
    return ResponseEntity.status(HttpStatus.CREATED)
        .cacheControl(CacheControl.noStore())
        .body(service.open((Long) auth.getPrincipal(), agentUserId));
  }
}
