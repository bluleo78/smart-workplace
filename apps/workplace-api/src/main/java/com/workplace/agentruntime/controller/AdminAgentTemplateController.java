package com.workplace.agentruntime.controller;

import com.workplace.agentruntime.dto.AgentTemplate;
import com.workplace.agentruntime.exception.AgentTemplateNotFoundException;
import com.workplace.agentruntime.service.AgentTemplateRegistry;
import com.workplace.global.security.RequireAdmin;
import com.workplace.global.security.RequirePermission;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * AI 실행 템플릿 조회 API(WP-1246) — 관리자가 AI 를 어떤 모습으로 띄울지 고를 때 보는 목록. 템플릿은 코드(클래스패스 YAML)로 정해져 있어 읽기만 한다.
 * AI 관리는 ADMIN 만(WP-729) — 키 발급 컨트롤러와 같은 가드.
 */
@RestController
@RequestMapping("/api/v1/admin/agent-templates")
@RequiredArgsConstructor
@RequireAdmin
public class AdminAgentTemplateController {

  private final AgentTemplateRegistry registry;

  /** 모든 실행 템플릿. */
  @GetMapping
  @RequirePermission("user:write")
  public ResponseEntity<List<AgentTemplate>> list() {
    return ResponseEntity.ok(registry.list());
  }

  /** 이름으로 실행 템플릿 한 개 — 없으면 404. */
  @GetMapping("/{name}")
  @RequirePermission("user:write")
  public ResponseEntity<AgentTemplate> get(@PathVariable String name) {
    return ResponseEntity.ok(registry.find(name).orElseThrow(AgentTemplateNotFoundException::new));
  }
}
