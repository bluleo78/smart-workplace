package com.workplace.issue.controller;

import com.workplace.issue.dto.AiAgentStatusResponse;
import com.workplace.issue.service.AiAgentStatusService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * 내 작업 › AI 위임 작업 「AI별」 보기(WP-1201). AI 마다 연결 여부·열린 작업·동시 진행 자리 수. 인증만 필요 — AI 위임 작업 목록과 같이 작업은
 * 호출자가 볼 수 있는 이슈만 싣는다.
 */
@RestController
@RequiredArgsConstructor
public class AiAgentsController {

  private final AiAgentStatusService aiAgentStatusService;

  /** GET /api/v1/me/ai-agents?scope=MINE|ALL — 기본 MINE(나와 관련). */
  @GetMapping("/api/v1/me/ai-agents")
  public ResponseEntity<AiAgentStatusResponse> list(
      Authentication auth, @RequestParam(defaultValue = "MINE") String scope) {
    return ResponseEntity.ok(aiAgentStatusService.list((Long) auth.getPrincipal(), scope));
  }
}
