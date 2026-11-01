package com.workplace.agentruntime.controller;

import com.workplace.agentruntime.dto.AgentRuntimeSummaryResponse;
import com.workplace.agentruntime.service.AgentRuntimeSummaryService;
import com.workplace.global.security.RequireAdmin;
import com.workplace.global.security.RequirePermission;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** AI 실행 상태 요약 API(WP-1254) — 관리자 AI 목록이 실행 상태를 한 번에 그린다. AI 관리는 ADMIN 만(WP-729). */
@RestController
@RequestMapping("/api/v1/admin/agent-runtime-summaries")
@RequiredArgsConstructor
@RequireAdmin
public class AdminAgentRuntimeSummaryController {

  private final AgentRuntimeSummaryService service;

  /** 실행 설정이 있는 모든 AI 의 실행 상태 요약(AI id 순). */
  @GetMapping
  @RequirePermission("user:write")
  public ResponseEntity<List<AgentRuntimeSummaryResponse>> list() {
    return ResponseEntity.ok(service.summaries());
  }
}
