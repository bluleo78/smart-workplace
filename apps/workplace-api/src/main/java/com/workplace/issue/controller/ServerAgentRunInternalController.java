package com.workplace.issue.controller;

import com.workplace.global.security.InternalOnBehalfOf;
import com.workplace.issue.dto.ServerAgentRunReport;
import com.workplace.issue.service.ServerAgentRunService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

/**
 * 서버 AI 의 이슈 실행 보고(WP-1219) — ai-agent 전용 내부 엔드포인트. 반복 회차 보고와 같이 Internal 토큰 + X-On-Behalf-Of(실행 AI
 * id) 인증만 받는다(사람 JWT·PAT·AI 키로는 403).
 */
@RestController
@RequiredArgsConstructor
public class ServerAgentRunInternalController {

  private final ServerAgentRunService runService;

  /** POST {phase, ok, note} — 반영했든 넘겼든(이슈가 끝남·담당 아님 등) 204. */
  @PostMapping("/api/v1/internal/issues/{issueId}/agent-runs")
  public ResponseEntity<Void> report(
      Authentication auth, @PathVariable long issueId, @RequestBody ServerAgentRunReport body) {
    InternalOnBehalfOf.requireInternal(auth, "내부 호출만 AI 실행을 보고할 수 있습니다");
    runService.report((Long) auth.getPrincipal(), issueId, body);
    return ResponseEntity.noContent().build();
  }
}
