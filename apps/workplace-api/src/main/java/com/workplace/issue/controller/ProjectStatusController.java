package com.workplace.issue.controller;

import com.workplace.global.security.RequirePermission;
import com.workplace.issue.dto.CreateProjectStatusRequest;
import com.workplace.issue.dto.ProjectStatusResponse;
import com.workplace.issue.dto.ReorderProjectStatusesRequest;
import com.workplace.issue.dto.StatusDeletionImpact;
import com.workplace.issue.dto.UpdateProjectStatusRequest;
import com.workplace.issue.service.ProjectStatusDeletionService;
import com.workplace.issue.service.ProjectStatusService;
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
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * 프로젝트 이슈 상태 REST API(WP-807). 조회·삭제 영향은 `project:read`, 추가·수정·순서 변경·삭제는 `project:manage`(+ 서비스의
 * OWNER 확인).
 */
@RestController
@RequestMapping("/api/v1/projects/{key}/statuses")
@RequiredArgsConstructor
public class ProjectStatusController {

  private final ProjectStatusService service;
  private final ProjectStatusDeletionService deletionService;

  /** 상태 목록 — 범주 순서 → position 순. */
  @GetMapping
  @RequirePermission("project:read")
  public ResponseEntity<List<ProjectStatusResponse>> list(
      Authentication auth, @PathVariable String key) {
    return ResponseEntity.ok(service.list((Long) auth.getPrincipal(), key));
  }

  /** 상태 추가 — 201. */
  @PostMapping
  @RequirePermission("project:manage")
  public ResponseEntity<ProjectStatusResponse> create(
      Authentication auth,
      @PathVariable String key,
      @Valid @RequestBody CreateProjectStatusRequest req) {
    return ResponseEntity.status(HttpStatus.CREATED)
        .body(service.create((Long) auth.getPrincipal(), key, req));
  }

  /** 상태 수정 — 이름·색 중 보낸 것만 바꾼다(이름만 보내던 구 웹 본문도 그대로 받는다). */
  @PatchMapping("/{statusId}")
  @RequirePermission("project:manage")
  public ResponseEntity<ProjectStatusResponse> update(
      Authentication auth,
      @PathVariable String key,
      @PathVariable Long statusId,
      @Valid @RequestBody UpdateProjectStatusRequest req) {
    return ResponseEntity.ok(service.update((Long) auth.getPrincipal(), key, statusId, req));
  }

  /** 같은 범주 안 순서 변경(WP-809) — 그 범주의 상태 전부를 새 순서로 받아 서버 정렬의 전체 목록을 돌려준다. */
  @PutMapping("/order")
  @RequirePermission("project:manage")
  public ResponseEntity<List<ProjectStatusResponse>> reorder(
      Authentication auth,
      @PathVariable String key,
      @Valid @RequestBody ReorderProjectStatusesRequest req) {
    return ResponseEntity.ok(service.reorder((Long) auth.getPrincipal(), key, req));
  }

  /** 삭제 영향(WP-809) — 활성 이슈 수·고칠 저장된 뷰 수·완료 이전을 막는 에픽 수·필터가 비는 뷰 수. 삭제 확인 창이 버튼·문구를 고른다. */
  @GetMapping("/{statusId}/deletion-impact")
  @RequirePermission("project:read")
  public ResponseEntity<StatusDeletionImpact> deletionImpact(
      Authentication auth, @PathVariable String key, @PathVariable long statusId) {
    return ResponseEntity.ok(deletionService.impact((Long) auth.getPrincipal(), key, statusId));
  }

  /** 상태 삭제(WP-809) — 그 상태의 이슈를 moveTo 로 옮기고 지운다. 활성 이슈가 있으면 moveTo 필수. 204. */
  @DeleteMapping("/{statusId}")
  @RequirePermission("project:manage")
  public ResponseEntity<Void> delete(
      Authentication auth,
      @PathVariable String key,
      @PathVariable long statusId,
      @RequestParam(required = false) Long moveTo) {
    deletionService.delete((Long) auth.getPrincipal(), key, statusId, moveTo);
    return ResponseEntity.noContent().build();
  }
}
