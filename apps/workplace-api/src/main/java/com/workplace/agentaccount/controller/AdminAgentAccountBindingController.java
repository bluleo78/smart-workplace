package com.workplace.agentaccount.controller;

import com.workplace.agentaccount.dto.AgentAccountBindingRequest;
import com.workplace.agentaccount.dto.AgentAccountResponse;
import com.workplace.agentaccount.service.AgentAccountBindingService;
import com.workplace.global.security.RequireAdmin;
import com.workplace.global.security.RequirePermission;
import com.workplace.global.security.RequireWebSession;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * AI → 계정 묶기 관리자 API(WP-1448) — 작업 공간(Pod) 실행 방식 AI 가 계정 목록의 어느 계정을 쓸지 고른다. 권한은 계정 목록 API 와 같다:
 * ADMIN + user:write, 쓰기는 웹 로그인 세션만. 다른 워크스페이스의 AI·계정은 404.
 */
@RestController
@RequestMapping("/api/v1/admin/agents/{userId}/agent-account")
@RequiredArgsConstructor
@RequireAdmin
public class AdminAgentAccountBindingController {

  private final AgentAccountBindingService service;

  /** AI 가 쓰는 계정 — 묶이지 않았으면 404. */
  @GetMapping
  @RequirePermission("user:write")
  public AgentAccountResponse get(@PathVariable long userId) {
    return service.get(userId);
  }

  /** AI 를 계정에 묶는다(옮기기 포함) — 묶은 계정의 메타를 돌려준다. 켜진 AI 는 쉴 때 적용된다(WP-1515). */
  @PutMapping
  @RequireWebSession
  @RequirePermission("user:write")
  public AgentAccountResponse bind(
      Authentication auth,
      @PathVariable long userId,
      @Valid @RequestBody AgentAccountBindingRequest req) {
    return service.bind((Long) auth.getPrincipal(), userId, req.accountId());
  }

  /** AI 의 묶음을 푼다(204, 멱등) — 사람 경로라 켜진 AI 는 쉴 때 적용된다(WP-1515). */
  @DeleteMapping
  @RequireWebSession
  @RequirePermission("user:write")
  public ResponseEntity<Void> unbind(Authentication auth, @PathVariable long userId) {
    service.unbindByPerson((Long) auth.getPrincipal(), userId);
    return ResponseEntity.noContent().build();
  }
}
