package com.workplace.auth.controller;

import com.workplace.auth.dto.SetWorkspaceAssistantRequest;
import com.workplace.auth.dto.UpdateAssistantSettingsRequest;
import com.workplace.auth.dto.WorkspaceAssistantResponse;
import com.workplace.auth.service.WorkspaceAssistantService;
import com.workplace.global.security.RequirePermission;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** 공용 비서 admin. 기존 agent 관리 권한(user:write) 사용. */
@RestController
@RequestMapping("/api/v1/admin/workspace-assistant")
@RequiredArgsConstructor
@RequirePermission("user:write")
public class WorkspaceAssistantController {

  private final WorkspaceAssistantService service;

  /** 현재 공용 비서 상태 조회. */
  @GetMapping
  public WorkspaceAssistantResponse get() {
    return service.get();
  }

  /** 공용 비서로 AGENT 지정. */
  @PutMapping
  public ResponseEntity<Void> set(
      Authentication auth, @Valid @RequestBody SetWorkspaceAssistantRequest req) {
    service.setAgent((Long) auth.getPrincipal(), req.agentUserId());
    return ResponseEntity.noContent().build();
  }

  /** 공용 비서 지정 해제. */
  @DeleteMapping
  public ResponseEntity<Void> clear() {
    service.clear();
    return ResponseEntity.noContent().build();
  }

  /** 공용 비서의 모델/사고 깊이 설정. */
  @PutMapping("/settings")
  public ResponseEntity<Void> updateSettings(
      Authentication auth, @Valid @RequestBody UpdateAssistantSettingsRequest req) {
    service.updateSettings((Long) auth.getPrincipal(), req.model(), req.thinkingDepth());
    return ResponseEntity.noContent().build();
  }
}
