package com.workplace.issue.workflow.controller;

import com.workplace.global.security.RequirePermission;
import com.workplace.issue.workflow.dto.AssignPreviewRequest;
import com.workplace.issue.workflow.dto.AssignPreviewView;
import com.workplace.issue.workflow.dto.IssueWorkflowView;
import com.workplace.issue.workflow.dto.MoveRequest;
import com.workplace.issue.workflow.dto.RecoverRequest;
import com.workplace.issue.workflow.dto.StartWorkflowRequest;
import com.workplace.issue.workflow.service.WorkflowAutoStartService;
import com.workplace.issue.workflow.service.WorkflowRecoveryService;
import com.workplace.issue.workflow.service.WorkflowRunService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 이슈의 워크플로우 실행 REST(WP-1985) — 조회·시작·이동, 멈춘 실행의 조치(WP-1986). 경로·필드·{@code errors.code} 는 웹·MCP·AI
 * 실행기가 쓰는 계약이다.
 *
 * <p>조회는 이슈 상세와 같은 {@code project:read}, 시작·이동·조치는 {@code issue:write}. 프로젝트별 읽기·구성원·담당·관리자 판정은
 * 서비스가 한다. 저장소를 직접 주입하지 않는다(트랜잭션은 서비스가 연다).
 */
@RestController
@RequestMapping("/api/v1/issues/{issueId}/workflow")
@RequiredArgsConstructor
public class IssueWorkflowController {

  private final WorkflowRunService runService;
  private final WorkflowRecoveryService recoveryService;
  private final WorkflowAutoStartService autoStartService;

  /** 실행 view — 실행이 없으면 200 과 빈 view. */
  @GetMapping
  @RequirePermission("project:read")
  public ResponseEntity<IssueWorkflowView> view(Authentication auth, @PathVariable long issueId) {
    return ResponseEntity.ok(runService.view(issueId, callerId(auth)));
  }

  /** 담당 지정 미리보기(WP-2120) — 저장 없이 시작될 워크플로우·시작 조건 역할을 알려 준다. 읽기 전용이라 view 와 같은 권한. */
  @PostMapping("/assign-preview")
  @RequirePermission("project:read")
  public ResponseEntity<AssignPreviewView> assignPreview(
      Authentication auth,
      @PathVariable long issueId,
      @Valid @RequestBody AssignPreviewRequest req) {
    return ResponseEntity.ok(
        autoStartService.preview(
            issueId, req.userIds(), Boolean.TRUE.equals(req.current()), callerId(auth)));
  }

  /** 시작 — dryRun 이면 저장하지 않는다. */
  @PostMapping("/start")
  @RequirePermission("issue:write")
  public ResponseEntity<IssueWorkflowView> start(
      Authentication auth,
      @PathVariable long issueId,
      @Valid @RequestBody StartWorkflowRequest req) {
    return ResponseEntity.ok(
        runService.start(issueId, req.workflowId(), req.isDryRun(), callerId(auth)));
  }

  /** 노드 이동. */
  @PostMapping("/move")
  @RequirePermission("issue:write")
  public ResponseEntity<IssueWorkflowView> move(
      Authentication auth, @PathVariable long issueId, @Valid @RequestBody MoveRequest req) {
    return ResponseEntity.ok(runService.move(issueId, req, callerId(auth)));
  }

  /** 멈춘 실행의 조치 — 다시 시도·onError·관리자 옮기기·취소(WP-1986). */
  @PostMapping("/recover")
  @RequirePermission("issue:write")
  public ResponseEntity<IssueWorkflowView> recover(
      Authentication auth, @PathVariable long issueId, @Valid @RequestBody RecoverRequest req) {
    return ResponseEntity.ok(recoveryService.recover(issueId, req, callerId(auth)));
  }

  /** 인증 주체(사용자 id). */
  private static long callerId(Authentication auth) {
    return (Long) auth.getPrincipal();
  }
}
