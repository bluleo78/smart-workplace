package com.workplace.agentruntime.controller;

import com.workplace.agentruntime.dto.AgentLocationResponse;
import com.workplace.agentruntime.dto.AgentLocationTokenResponse;
import com.workplace.agentruntime.dto.CreateAgentLocationRequest;
import com.workplace.agentruntime.dto.UpdateAgentLocationRequest;
import com.workplace.agentruntime.service.AgentLocationService;
import com.workplace.global.security.RequireAdmin;
import com.workplace.global.security.RequirePermission;
import com.workplace.global.security.RequireWebSession;
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

/**
 * AI 실행 위치 관리 API(WP-1248) — 위치 등록·수정·기본 이동·삭제와 runner 토큰 발급·재발급. AI 관리는 ADMIN 만(WP-729). 토큰 평문을
 * 돌려주는 POST 는 웹 세션만 허용한다(개인 토큰·AI 키로는 열쇠를 새로 받지 못하게 — AI 키 발급과 같은 가드).
 */
@RestController
@RequestMapping("/api/v1/admin/agent-locations")
@RequiredArgsConstructor
@RequireAdmin
public class AdminAgentLocationController {

  private final AgentLocationService service;

  /** 위치 목록(토큰 평문 없음). */
  @GetMapping
  @RequirePermission("user:write")
  public ResponseEntity<List<AgentLocationResponse>> list() {
    return ResponseEntity.ok(service.list());
  }

  /** 위치 등록 — 응답의 plaintextToken 은 한 번만 보인다. */
  @PostMapping
  @RequireWebSession
  @RequirePermission("user:write")
  public ResponseEntity<AgentLocationTokenResponse> create(
      Authentication auth, @Valid @RequestBody CreateAgentLocationRequest req) {
    return ResponseEntity.ok(service.create((Long) auth.getPrincipal(), req));
  }

  /** 이름·설명·자리 수 수정. */
  @PutMapping("/{id}")
  @RequirePermission("user:write")
  public ResponseEntity<AgentLocationResponse> update(
      @PathVariable long id, @Valid @RequestBody UpdateAgentLocationRequest req) {
    return ResponseEntity.ok(service.update(id, req));
  }

  /** 이 위치를 기본으로. */
  @PostMapping("/{id}/default")
  @RequirePermission("user:write")
  public ResponseEntity<Void> setDefault(@PathVariable long id) {
    service.setDefault(id);
    return ResponseEntity.noContent().build();
  }

  /** runner 토큰 재발급 — 옛 토큰은 회수된다. 평문은 한 번만 보인다. */
  @PostMapping("/{id}/token")
  @RequireWebSession
  @RequirePermission("user:write")
  public ResponseEntity<AgentLocationTokenResponse> rotateToken(
      Authentication auth, @PathVariable long id) {
    return ResponseEntity.ok(service.rotateToken((Long) auth.getPrincipal(), id));
  }

  /** 위치 삭제 — 기본 위치는 409. */
  @DeleteMapping("/{id}")
  @RequirePermission("user:write")
  public ResponseEntity<Void> delete(Authentication auth, @PathVariable long id) {
    service.delete((Long) auth.getPrincipal(), id);
    return ResponseEntity.noContent().build();
  }
}
