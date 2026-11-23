package com.workplace.issue.workflow.controller;

import com.workplace.global.security.RequirePermission;
import com.workplace.issue.workflow.dto.WorkflowRunDetail;
import com.workplace.issue.workflow.dto.WorkflowRunPage;
import com.workplace.issue.workflow.service.WorkflowRunQueryService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * 워크플로우 실행 목록·상세 REST(WP-1985). 둘 다 이슈 상세 GET 과 같은 {@code project:read} 이고, 프로젝트별 읽기 판정(못 보면 404)은
 * 서비스가 한다. 저장소를 직접 주입하지 않는다.
 */
@RestController
@RequestMapping("/api/v1")
@RequiredArgsConstructor
public class WorkflowRunController {

  private final WorkflowRunQueryService queryService;

  /** 정의의 실행 목록 — 최신순 cursor, status·node·assigneeId 로 거른다. */
  @GetMapping("/workflows/{id}/runs")
  @RequirePermission("project:read")
  public ResponseEntity<WorkflowRunPage> runs(
      Authentication auth,
      @PathVariable long id,
      @RequestParam(required = false) String status,
      @RequestParam(required = false) String node,
      @RequestParam(required = false) Long assigneeId,
      @RequestParam(required = false) String cursor,
      @RequestParam(required = false) Integer size) {
    return ResponseEntity.ok(
        queryService.runs(id, status, node, assigneeId, cursor, size, callerId(auth)));
  }

  /** 실행 한 건 — 실행·노드 방문·이벤트·고정한 버전의 모델. */
  @GetMapping("/workflow-runs/{runId}")
  @RequirePermission("project:read")
  public ResponseEntity<WorkflowRunDetail> detail(Authentication auth, @PathVariable long runId) {
    return ResponseEntity.ok(queryService.detail(runId, callerId(auth)));
  }

  /** 인증 주체(사용자 id). */
  private static long callerId(Authentication auth) {
    return (Long) auth.getPrincipal();
  }
}
