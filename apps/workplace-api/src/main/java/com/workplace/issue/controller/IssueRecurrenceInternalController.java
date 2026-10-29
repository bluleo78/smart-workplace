package com.workplace.issue.controller;

import com.workplace.global.security.InternalOnBehalfOf;
import com.workplace.issue.dto.IssueRecurrenceRunReport;
import com.workplace.issue.service.IssueRecurrenceService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

/**
 * 반복 AI 작업(WP-989) 회차 결과 보고 — ai-agent 전용 내부 엔드포인트. ai-agent 의 다른 API 호출과 같은 Internal 토큰 +
 * X-On-Behalf-Of(실행 AI id) 인증만 받는다(사람 JWT·PAT·AI 키로는 403). 이슈 회차 실행은 MCP 쓰기 도구 없이 돌기 때문에 결과 글은 이
 * 보고로 서버가 대신 남긴다.
 */
@RestController
@RequiredArgsConstructor
public class IssueRecurrenceInternalController {

  private final IssueRecurrenceService recurrenceService;

  /** POST {runId, ok, message} — 반영했든 무시했든(중복·지난 회차) 204. */
  @PostMapping("/api/v1/internal/issue-recurrence/{issueId}/runs")
  public ResponseEntity<Void> report(
      Authentication auth, @PathVariable long issueId, @RequestBody IssueRecurrenceRunReport body) {
    InternalOnBehalfOf.requireInternal(auth, "내부 호출만 반복 회차 결과를 보고할 수 있습니다");
    recurrenceService.reportRun((Long) auth.getPrincipal(), issueId, body);
    return ResponseEntity.noContent().build();
  }
}
