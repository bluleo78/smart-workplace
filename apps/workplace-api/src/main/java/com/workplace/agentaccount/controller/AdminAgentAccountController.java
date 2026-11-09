package com.workplace.agentaccount.controller;

import com.workplace.agentaccount.dto.AgentAccountRequest;
import com.workplace.agentaccount.dto.AgentAccountResponse;
import com.workplace.agentaccount.dto.AgentAccountUpdateRequest;
import com.workplace.agentaccount.service.AgentAccountService;
import com.workplace.global.security.RequireAdmin;
import com.workplace.global.security.RequirePermission;
import com.workplace.global.security.RequireWebSession;
import jakarta.validation.Valid;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * AI 계정 목록 관리자 API(WP-1448) — 팀 AI 가 쓰는 키를 AI 와 떼어 등록·조회·수정·폐기한다. AI 연결 관리
 * (AdminProviderCredentialController)와 같은 권한: ADMIN + user:write, 키를 새로 넣는 쓰기는 웹 로그인 세션만. 평문 키는
 * 등록·교체 요청 본문에만 실리고 응답에는 메타만 나간다. 다른 워크스페이스의 계정은 404.
 */
@RestController
@RequestMapping("/api/v1/admin/agent-accounts")
@RequiredArgsConstructor
@RequireAdmin
public class AdminAgentAccountController {

  private final AgentAccountService service;

  /** 계정 등록(201) — 같은 키의 계정이 이미 있으면 409, 형식이 틀리면 400. */
  @PostMapping
  @RequireWebSession
  @RequirePermission("user:write")
  public ResponseEntity<AgentAccountResponse> register(
      Authentication auth, @Valid @RequestBody AgentAccountRequest req) {
    return ResponseEntity.status(HttpStatus.CREATED)
        .body(service.register((Long) auth.getPrincipal(), req));
  }

  /** 계정 목록 — 쓰는 AI 포함, 폐기된 계정 제외. */
  @GetMapping
  @RequirePermission("user:write")
  public List<AgentAccountResponse> list() {
    return service.list();
  }

  /** 계정 한 건 — 없으면 404. */
  @GetMapping("/{id}")
  @RequirePermission("user:write")
  public AgentAccountResponse get(@PathVariable long id) {
    return service.get(id);
  }

  /** 라벨 변경 또는 원문 교체 — 원문을 바꾸면 이 계정을 쓰는 AI 의 Pod 가 새 키를 받는다. */
  @PatchMapping("/{id}")
  @RequireWebSession
  @RequirePermission("user:write")
  public AgentAccountResponse update(
      Authentication auth,
      @PathVariable long id,
      @Valid @RequestBody AgentAccountUpdateRequest req) {
    return service.update((Long) auth.getPrincipal(), id, req);
  }

  /** 폐기(204) — 쓰는 AI 가 있으면 409. */
  @DeleteMapping("/{id}")
  @RequirePermission("user:write")
  public ResponseEntity<Void> revoke(Authentication auth, @PathVariable long id) {
    service.revoke((Long) auth.getPrincipal(), id);
    return ResponseEntity.noContent().build();
  }
}
