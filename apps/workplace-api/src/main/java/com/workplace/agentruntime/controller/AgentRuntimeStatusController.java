package com.workplace.agentruntime.controller;

import com.workplace.agentruntime.dto.AgentStatusReportRequest;
import com.workplace.agentruntime.dto.AgentStatusReportResponse;
import com.workplace.agentruntime.exception.AgentStatusAgentOnlyException;
import com.workplace.agentruntime.service.AgentStatusReportService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * AI 상태 보고 API(WP-1250) — Works 가 띄운 AI 가 자기 키({@code ak_})로 지금 상태를 알리고, 계속 일할지·멈출지를 받는다. 계약은
 * docs/integrations/agent-runner-api.md 「AI 상태 보고」.
 */
@RestController
@RequestMapping("/api/v1/agent-runtime/me")
@RequiredArgsConstructor
public class AgentRuntimeStatusController {

  private final AgentStatusReportService service;

  /** AI 키 인증({@code ak_})에 붙는 권한 — ApiKeyAuthenticationFilter 가 넣는다. */
  private static final String ROLE_AGENT = "ROLE_AGENT";

  /** 상태 보고 — AI 키로 인증한 호출만(아니면 403). DB 를 보기 전에 인증 권한으로 가른다. 실행 설정이 없는 AI(외부 실행)는 저장 없이 RUN. */
  @PutMapping("/status")
  public ResponseEntity<AgentStatusReportResponse> report(
      @AuthenticationPrincipal Long userId,
      Authentication authentication,
      @Valid @RequestBody AgentStatusReportRequest req) {
    boolean agent =
        authentication.getAuthorities().stream().anyMatch(a -> ROLE_AGENT.equals(a.getAuthority()));
    if (!agent) throw new AgentStatusAgentOnlyException();
    return ResponseEntity.ok(service.report(userId, req));
  }
}
