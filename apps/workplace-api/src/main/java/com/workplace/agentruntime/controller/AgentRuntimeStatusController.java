package com.workplace.agentruntime.controller;

import com.workplace.agentruntime.dto.AgentRuntimeProjectResponse;
import com.workplace.agentruntime.dto.AgentStatusReportRequest;
import com.workplace.agentruntime.dto.AgentStatusReportResponse;
import com.workplace.agentruntime.dto.ReportedModelsRequest;
import com.workplace.agentruntime.service.AgentRuntimeSummaryService;
import com.workplace.agentruntime.service.AgentStatusReportService;
import com.workplace.auth.dto.ModelOption;
import com.workplace.auth.service.AgentReportedModelService;
import com.workplace.global.security.RequireAgent;
import jakarta.validation.Valid;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * AI 자신의 실행 API — 자기 키({@code ak_})로 부른다. 상태 보고(WP-1250): Works 가 띄운 AI 가 지금 상태를 알리고 계속 일할지·멈출지를
 * 받는다. 맡는 프로젝트(WP-1275): 작업 공간·start-agent 가 칸을 열 프로젝트와 저장소를 받는다. 모델 목록 보고(WP-1297): 로그인 계정으로 도는 AI
 * 가 자기 프로그램이 쓸 수 있는 모델 목록을 알린다. 계약은 docs/integrations/agent-runner-api.md. 모두 AI 키로 인증한 호출만 — 아니면
 * 403 {@code AGENT_ONLY}({@link RequireAgent}).
 */
@RestController
@RequireAgent
@RequestMapping("/api/v1/agent-runtime/me")
@RequiredArgsConstructor
public class AgentRuntimeStatusController {

  private final AgentStatusReportService service;
  private final AgentRuntimeSummaryService summaries;
  private final AgentReportedModelService reportedModels;

  /** 상태 보고 — 실행 설정이 없는 AI(외부 실행)는 저장 없이 RUN. */
  @PutMapping("/status")
  public ResponseEntity<AgentStatusReportResponse> report(
      @AuthenticationPrincipal Long userId, @Valid @RequestBody AgentStatusReportRequest req) {
    return ResponseEntity.ok(service.report(userId, req));
  }

  /**
   * 맡는 프로젝트 — 실제 멤버이고 연결된 저장소가 있으며 키가 작업 공간 이름 형식인 프로젝트(키 순). 관리자 화면의 「맡는 프로젝트」와 같은 목록이다. 외부에서 돌리는
   * AI 도 부른다(start-agent).
   */
  @GetMapping("/projects")
  public List<AgentRuntimeProjectResponse> projects(@AuthenticationPrincipal Long userId) {
    return summaries.myProjects(userId);
  }

  /**
   * 로그인 계정 모델 목록 보고(WP-1297) — 이 AI 의 활성 연결이 로그인 계정(genia·chatgpt)이고 보고의 {@code loginVersion} 이 그
   * 연결 id 와 같을 때만 저장하고(덮어쓴다) 아니면 저장 없이 무시한다. 어느 쪽이든 204 — 보고는 최선 노력이라 Pod 가 연결 교체 중의 어긋남으로 실패 신호를
   * 받지 않게 한다. 목록은 관리자 화면의 「모델」 칸이 돌려받는다.
   */
  @PutMapping("/models")
  public ResponseEntity<Void> reportModels(
      @AuthenticationPrincipal Long userId, @Valid @RequestBody ReportedModelsRequest req) {
    reportedModels.report(
        userId,
        req.loginVersion(),
        req.models().stream().map(m -> new ModelOption(m.id(), m.label(), m.efforts())).toList());
    return ResponseEntity.noContent().build();
  }
}
