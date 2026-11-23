package com.workplace.issue.controller;

import com.workplace.global.dto.UserSummary;
import com.workplace.global.security.RequirePermission;
import com.workplace.issue.service.IssueAssigneeService;
import com.workplace.issue.workflow.service.WorkflowAssignStartService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** 이슈 담당자 집합 교체 — PUT 단일 엔드포인트. */
@RestController
@RequestMapping("/api/v1/projects/{key}/issues/{number}/assignees")
@RequiredArgsConstructor
public class IssueAssigneeController {

  private final IssueAssigneeService service;
  private final WorkflowAssignStartService assignStartService;

  /**
   * 담당자 집합 교체 요청 본문.
   *
   * @param startWorkflowId 있으면 교체 직후 같은 트랜잭션에서 이 정의를 시작한다(「지정하고 바로 시작」, WP-1986). 시작이 실패하면 교체도 되돌린다
   */
  public record ReplaceAssigneesRequest(@NotNull List<Long> userIds, Long startWorkflowId) {}

  /** 담당자 집합을 통째로 교체하고 갱신 후의 담당자 요약 리스트를 반환한다. startWorkflowId 가 있으면 이어서 그 정의를 시작한다. */
  @PutMapping
  @RequirePermission("issue:write")
  public ResponseEntity<List<UserSummary>> replace(
      Authentication auth,
      @PathVariable String key,
      @PathVariable int number,
      @Valid @RequestBody ReplaceAssigneesRequest req) {
    Long callerId = (Long) auth.getPrincipal();
    if (req.startWorkflowId() != null) {
      return ResponseEntity.ok(
          assignStartService.replaceAndStart(
              callerId, key, number, req.userIds(), req.startWorkflowId()));
    }
    return ResponseEntity.ok(service.replace(callerId, key, number, req.userIds()));
  }
}
