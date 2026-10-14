package com.workplace.issue.controller;

import com.workplace.issue.dto.AgentWorkReportResponse;
import com.workplace.issue.dto.ReportAgentWorkRequest;
import com.workplace.issue.service.AgentWorkReportService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** AI 작업 명시 보고(WP-377) — PUT 하나로 시작·갱신·종료. 수행 도구는 X-Agent-Tool 헤더로 받는다. */
@RestController
@RequestMapping("/api/v1/projects/{key}/issues/{number}/agent-work")
@RequiredArgsConstructor
public class AgentWorkController {

  private final AgentWorkReportService service;

  @PutMapping
  public ResponseEntity<AgentWorkReportResponse> report(
      @AuthenticationPrincipal Long callerId,
      @PathVariable String key,
      @PathVariable int number,
      @Valid @RequestBody ReportAgentWorkRequest req) {
    return ResponseEntity.ok(service.report(callerId, key, number, req));
  }
}
