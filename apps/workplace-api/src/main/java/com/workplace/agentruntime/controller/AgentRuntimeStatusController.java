package com.workplace.agentruntime.controller;

import com.workplace.agentruntime.dto.AgentRuntimeProjectResponse;
import com.workplace.agentruntime.dto.AgentStatusReportRequest;
import com.workplace.agentruntime.dto.AgentStatusReportResponse;
import com.workplace.agentruntime.exception.AgentOnlyException;
import com.workplace.agentruntime.service.AgentRuntimeSummaryService;
import com.workplace.agentruntime.service.AgentStatusReportService;
import jakarta.validation.Valid;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * AI 자신의 실행 API — 자기 키({@code ak_})로 부른다. 상태 보고(WP-1250): Works 가 띄운 AI 가 지금 상태를 알리고 계속 일할지·멈출지를
 * 받는다. 맡는 프로젝트(WP-1275): 작업 공간·start-agent 가 칸을 열 프로젝트와 저장소를 받는다. 계약은
 * docs/integrations/agent-runner-api.md.
 */
@RestController
@RequestMapping("/api/v1/agent-runtime/me")
@RequiredArgsConstructor
public class AgentRuntimeStatusController {

  private final AgentStatusReportService service;
  private final AgentRuntimeSummaryService summaries;

  /** AI 키 인증({@code ak_})에 붙는 권한 — ApiKeyAuthenticationFilter 가 넣는다. */
  private static final String ROLE_AGENT = "ROLE_AGENT";

  /** 상태 보고 — AI 키로 인증한 호출만(아니면 403). DB 를 보기 전에 인증 권한으로 가른다. 실행 설정이 없는 AI(외부 실행)는 저장 없이 RUN. */
  @PutMapping("/status")
  public ResponseEntity<AgentStatusReportResponse> report(
      @AuthenticationPrincipal Long userId,
      Authentication authentication,
      @Valid @RequestBody AgentStatusReportRequest req) {
    if (!isAgent(authentication)) throw AgentOnlyException.forStatusReport();
    return ResponseEntity.ok(service.report(userId, req));
  }

  /**
   * 맡는 프로젝트 — 실제 멤버이고 연결된 저장소가 있으며 키가 작업 공간 이름 형식인 프로젝트(키 순). 관리자 화면의 「맡는 프로젝트」와 같은 목록이다. AI 키로 인증한
   * 호출만(아니면 403). 외부에서 돌리는 AI 도 부른다(start-agent).
   */
  @GetMapping("/projects")
  public List<AgentRuntimeProjectResponse> projects(
      @AuthenticationPrincipal Long userId, Authentication authentication) {
    if (!isAgent(authentication)) throw AgentOnlyException.forProjects();
    return summaries.myProjects(userId);
  }

  private static boolean isAgent(Authentication authentication) {
    return authentication.getAuthorities().stream()
        .anyMatch(a -> ROLE_AGENT.equals(a.getAuthority()));
  }
}
