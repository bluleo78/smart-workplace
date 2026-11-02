package com.workplace.agentruntime.controller;

import com.workplace.agentruntime.dto.RunnerAgentKeyResponse;
import com.workplace.agentruntime.dto.RunnerClaudeSecretResponse;
import com.workplace.agentruntime.dto.RunnerDesiredResponse;
import com.workplace.agentruntime.dto.RunnerObservedRequest;
import com.workplace.agentruntime.dto.RunnerObservedResponse;
import com.workplace.agentruntime.dto.RunnerPrincipal;
import com.workplace.agentruntime.dto.RunnerReposSecretResponse;
import com.workplace.agentruntime.realtime.RunnerSseRegistry;
import com.workplace.agentruntime.service.RunnerDesiredStateService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.CacheControl;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

/**
 * runner 전용 API(WP-1249) — 원하는 상태 조회·관찰 상태 보고·변경 스트림. runner 토큰({@code Bearer rt_})으로만
 * 닿는다(SecurityConfig 의 ROLE_RUNNER 규칙). 주체는 토큰이 묶인 테넌트·위치이고, 계약은
 * docs/integrations/agent-runner-api.md.
 */
@RestController
@RequestMapping("/api/v1/agent-runtime/runner")
@RequiredArgsConstructor
public class RunnerAgentRuntimeController {

  private final RunnerDesiredStateService service;
  private final RunnerSseRegistry sseRegistry;

  /** 이 위치에 떠 있어야 할 AI 목록. */
  @GetMapping("/desired")
  public ResponseEntity<RunnerDesiredResponse> desired(
      @AuthenticationPrincipal RunnerPrincipal principal) {
    return ResponseEntity.ok(service.desired(principal));
  }

  /** runner 가 본 Pod 상태 보고. */
  @PostMapping("/observed")
  public ResponseEntity<RunnerObservedResponse> observed(
      @AuthenticationPrincipal RunnerPrincipal principal,
      @Valid @RequestBody RunnerObservedRequest req) {
    return ResponseEntity.ok(service.observed(principal, req));
  }

  /** AI 키 자동 발급·교체(WP-1253) — 평문이 실리므로 캐시 금지. 이 위치에서 켜져 있는 AI 만(아니면 404). */
  @PostMapping("/agents/{agentUserId}/agent-key")
  public ResponseEntity<RunnerAgentKeyResponse> issueAgentKey(
      @AuthenticationPrincipal RunnerPrincipal principal, @PathVariable long agentUserId) {
    return ResponseEntity.ok()
        .cacheControl(CacheControl.noStore())
        .body(service.issueAgentKey(principal, agentUserId));
  }

  /** 모델 연결 원문(WP-1253) — 캐시 금지. 이 위치에서 켜져 있고 연결이 등록된 AI 만(아니면 404). */
  @GetMapping("/agents/{agentUserId}/secrets/claude")
  public ResponseEntity<RunnerClaudeSecretResponse> claudeSecret(
      @AuthenticationPrincipal RunnerPrincipal principal, @PathVariable long agentUserId) {
    return ResponseEntity.ok()
        .cacheControl(CacheControl.noStore())
        .body(service.claudeSecret(principal, agentUserId));
  }

  /** AI 별 저장소 토큰 원문(WP-1268) — 캐시 금지. 이 위치에서 켜져 있는 AI 만(아니면 404). 토큰이 없으면 빈 목록·version null. */
  @GetMapping("/agents/{agentUserId}/secrets/repos")
  public ResponseEntity<RunnerReposSecretResponse> reposSecret(
      @AuthenticationPrincipal RunnerPrincipal principal, @PathVariable long agentUserId) {
    return ResponseEntity.ok()
        .cacheControl(CacheControl.noStore())
        .body(service.reposSecret(principal, agentUserId));
  }

  /** 변경 스트림 — 첫 코멘트 connected, 이벤트 agent-runtime.changed {"locationId":n}. */
  @GetMapping(value = "/events", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
  public SseEmitter events(@AuthenticationPrincipal RunnerPrincipal principal) {
    return sseRegistry.register(principal.tenantId(), principal.locationId());
  }
}
