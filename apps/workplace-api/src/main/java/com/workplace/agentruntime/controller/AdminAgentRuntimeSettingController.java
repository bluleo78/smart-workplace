package com.workplace.agentruntime.controller;

import com.workplace.agentruntime.dto.AgentRuntimeSettingResponse;
import com.workplace.agentruntime.dto.PutAgentRuntimeSettingRequest;
import com.workplace.agentruntime.service.AgentRuntimeSettingService;
import com.workplace.global.security.RequireAdmin;
import com.workplace.global.security.RequirePermission;
import jakarta.validation.Valid;
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

  /** 실행 설정 조회 — 없으면 404(=「기본」 템플릿으로 도는 AI). */
  @GetMapping
  @RequirePermission("user:write")
  public ResponseEntity<AgentRuntimeSettingResponse> get(@PathVariable long userId) {
    return ResponseEntity.ok(service.get(userId));
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
