package com.workplace.issue.workflow.controller;

import com.workplace.global.security.RequirePermission;
import com.workplace.issue.workflow.dto.CreateWorkflowRequest;
import com.workplace.issue.workflow.dto.ExpectedDraftRequest;
import com.workplace.issue.workflow.dto.PublishResult;
import com.workplace.issue.workflow.dto.PublishWorkflowRequest;
import com.workplace.issue.workflow.dto.SaveDraftResult;
import com.workplace.issue.workflow.dto.SaveWorkflowDraftRequest;
import com.workplace.issue.workflow.dto.UpdateWorkflowRequest;
import com.workplace.issue.workflow.dto.ValidateWorkflowRequest;
import com.workplace.issue.workflow.dto.WorkflowDetail;
import com.workplace.issue.workflow.dto.WorkflowSummary;
import com.workplace.issue.workflow.dto.WorkflowValidationResult;
import com.workplace.issue.workflow.dto.WorkflowVersionDetail;
import com.workplace.issue.workflow.dto.WorkflowVersionSummary;
import com.workplace.issue.workflow.service.WorkflowDefinitionService;
import jakarta.validation.Valid;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 워크플로우 정의 REST API(WP-1984). 경로·필드·상태·{@code errors.code} 는 실행 엔진·편집기·MCP 도구가 쓰는 계약이다.
 *
 * <p>읽기·validate 는 {@code project:read}, 쓰기 다섯은 {@code project:manage} — AGENT 기본 역할에 일부러 없는
 * 권한이다(게시는 다른 AI 의 지시를 바꾸는 일). 프로젝트별 읽기·OWNER 판정은 서비스가 한다.
 */
@RestController
@RequestMapping("/api/v1")
@RequiredArgsConstructor
public class WorkflowController {

  private final WorkflowDefinitionService workflowService;

  /** 프로젝트의 워크플로우 목록. */
  @GetMapping("/projects/{projectId}/workflows")
  @RequirePermission("project:read")
  public ResponseEntity<List<WorkflowSummary>> list(
      Authentication auth, @PathVariable long projectId) {
    return ResponseEntity.ok(workflowService.list(projectId, callerId(auth)));
  }

  /** 만들기 — 이것만 201. */
  @PostMapping("/projects/{projectId}/workflows")
  @RequirePermission("project:manage")
  public ResponseEntity<WorkflowDetail> create(
      Authentication auth,
      @PathVariable long projectId,
      @Valid @RequestBody CreateWorkflowRequest req) {
    return ResponseEntity.status(HttpStatus.CREATED)
        .body(workflowService.create(projectId, req, callerId(auth)));
  }

  /** 한 건(초안·활성 버전·초안의 문제). */
  @GetMapping("/workflows/{id}")
  @RequirePermission("project:read")
  public ResponseEntity<WorkflowDetail> get(Authentication auth, @PathVariable long id) {
    return ResponseEntity.ok(workflowService.get(id, callerId(auth)));
  }

  /** 초안 저장 — 오류가 있어도 저장한다. */
  @PutMapping("/workflows/{id}/draft")
  @RequirePermission("project:manage")
  public ResponseEntity<SaveDraftResult> saveDraft(
      Authentication auth,
      @PathVariable long id,
      @Valid @RequestBody SaveWorkflowDraftRequest req) {
    return ResponseEntity.ok(workflowService.saveDraft(id, req, callerId(auth)));
  }

  /** 저장 없이 검증. */
  @PostMapping("/workflows/validate")
  @RequirePermission("project:read")
  public ResponseEntity<WorkflowValidationResult> validate(
      Authentication auth, @Valid @RequestBody ValidateWorkflowRequest req) {
    return ResponseEntity.ok(workflowService.validate(req, callerId(auth)));
  }

  /** 게시 — 본문이 없으면 충돌 검사를 건너뛰고, enable=true 면 게시와 함께 켠다. */
  @PostMapping("/workflows/{id}/publish")
  @RequirePermission("project:manage")
  public ResponseEntity<PublishResult> publish(
      Authentication auth,
      @PathVariable long id,
      @Valid @RequestBody(required = false) PublishWorkflowRequest req) {
    return ResponseEntity.ok(
        workflowService.publish(
            id,
            req == null ? null : req.expectedDraftUpdatedAt(),
            req != null && Boolean.TRUE.equals(req.enable()),
            callerId(auth)));
  }

  /** 게시 버전 목록. */
  @GetMapping("/workflows/{id}/versions")
  @RequirePermission("project:read")
  public ResponseEntity<List<WorkflowVersionSummary>> versions(
      Authentication auth, @PathVariable long id) {
    return ResponseEntity.ok(workflowService.versions(id, callerId(auth)));
  }

  /** 게시 버전 한 건(원문·모델). */
  @GetMapping("/workflows/{id}/versions/{no}")
  @RequirePermission("project:read")
  public ResponseEntity<WorkflowVersionDetail> version(
      Authentication auth, @PathVariable long id, @PathVariable int no) {
    return ResponseEntity.ok(workflowService.version(id, no, callerId(auth)));
  }

  /** 그 버전 원문을 초안으로 되돌린다(게시하지 않는다) — 게시처럼 본문이 없으면 충돌 검사를 건너뛴다. */
  @PostMapping("/workflows/{id}/versions/{no}/restore-draft")
  @RequirePermission("project:manage")
  public ResponseEntity<WorkflowDetail> restoreDraft(
      Authentication auth,
      @PathVariable long id,
      @PathVariable int no,
      @Valid @RequestBody(required = false) ExpectedDraftRequest req) {
    return ResponseEntity.ok(
        workflowService.restoreDraft(
            id, no, req == null ? null : req.expectedDraftUpdatedAt(), callerId(auth)));
  }

  /** 켜기·끄기·이름 바꾸기. */
  @PatchMapping("/workflows/{id}")
  @RequirePermission("project:manage")
  public ResponseEntity<WorkflowDetail> update(
      Authentication auth, @PathVariable long id, @Valid @RequestBody UpdateWorkflowRequest req) {
    return ResponseEntity.ok(workflowService.update(id, req, callerId(auth)));
  }

  /** 인증 주체(사용자 id). */
  private static long callerId(Authentication auth) {
    return (Long) auth.getPrincipal();
  }
}
