package com.workplace.agentruntime.controller;

import com.workplace.agentruntime.dto.AgentRuntimeProjectResponse;
import com.workplace.agentruntime.dto.AgentRuntimeSettingResponse;
import com.workplace.agentruntime.dto.PutAgentRuntimeSettingRequest;
import com.workplace.agentruntime.service.AgentRuntimeSettingService;
import com.workplace.agentruntime.service.AgentRuntimeSummaryService;
import com.workplace.global.security.RequireAdmin;
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
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** AI 별 실행 설정 API(WP-1247) — 실행 템플릿·위치·설정 저장과 켜기·끄기·다시 시작. AI 관리는 ADMIN 만(WP-729). */
@RestController
@RequestMapping("/api/v1/admin/agents/{userId}/runtime-setting")
@RequiredArgsConstructor
@RequireAdmin
public class AdminAgentRuntimeSettingController {

  private final AgentRuntimeSettingService service;
  private final AgentRuntimeSummaryService summaryService;

  /** 실행 설정 조회 — 없으면 404(=「기본」 템플릿으로 도는 AI). */
  @GetMapping
  @RequirePermission("user:write")
  public ResponseEntity<AgentRuntimeSettingResponse> get(@PathVariable long userId) {
    return ResponseEntity.ok(service.get(userId));
  }

  /**
   * AI 가 작업 공간에서 맡을 프로젝트(WP-1255) — 실제 멤버이고 연결된 저장소가 있는 프로젝트(키 순). 구성원이 아니거나 AI 가 아니면 404. 실행 설정이
   * 없어도 돌려준다.
   */
  @GetMapping("/projects")
  @RequirePermission("user:write")
  public ResponseEntity<List<AgentRuntimeProjectResponse>> projects(@PathVariable long userId) {
    return ResponseEntity.ok(summaryService.projects(userId));
  }

  /** 실행 설정 저장 — 실행 방식은 EXTERNAL 로 바뀐다. */
  @PutMapping
  @RequirePermission("user:write")
  public ResponseEntity<AgentRuntimeSettingResponse> put(
      Authentication auth,
      @PathVariable long userId,
      @Valid @RequestBody PutAgentRuntimeSettingRequest req) {
    return ResponseEntity.ok(service.put((Long) auth.getPrincipal(), userId, req));
  }

  /** 실행 설정 삭제 — 켜져 있으면 409. */
  @DeleteMapping
  @RequirePermission("user:write")
  public ResponseEntity<Void> delete(Authentication auth, @PathVariable long userId) {
    service.delete((Long) auth.getPrincipal(), userId);
    return ResponseEntity.noContent().build();
  }

  /** 켜기. */
  @PostMapping("/start")
  @RequirePermission("user:write")
  public ResponseEntity<AgentRuntimeSettingResponse> start(
      Authentication auth, @PathVariable long userId) {
    return ResponseEntity.ok(service.start((Long) auth.getPrincipal(), userId));
  }

  /** 끄기. */
  @PostMapping("/stop")
  @RequirePermission("user:write")
  public ResponseEntity<AgentRuntimeSettingResponse> stop(
      Authentication auth, @PathVariable long userId) {
    return ResponseEntity.ok(service.stop((Long) auth.getPrincipal(), userId));
  }

  /** 다시 시작 — 켜져 있을 때만. */
  @PostMapping("/restart")
  @RequirePermission("user:write")
  public ResponseEntity<AgentRuntimeSettingResponse> restart(
      Authentication auth, @PathVariable long userId) {
    return ResponseEntity.ok(service.restart((Long) auth.getPrincipal(), userId));
  }
}
