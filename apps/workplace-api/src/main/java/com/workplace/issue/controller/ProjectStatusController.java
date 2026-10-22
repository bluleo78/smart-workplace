package com.workplace.issue.controller;

import com.workplace.global.security.RequirePermission;
import com.workplace.issue.dto.CreateProjectStatusRequest;
import com.workplace.issue.dto.ProjectStatusResponse;
import com.workplace.issue.dto.RenameProjectStatusRequest;
import com.workplace.issue.service.ProjectStatusService;
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
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** 프로젝트 이슈 상태 REST API(WP-807). 조회는 `project:read`, 추가·이름 변경은 `project:manage`(+ 서비스의 OWNER 확인). */
@RestController
@RequestMapping("/api/v1/projects/{key}/statuses")
@RequiredArgsConstructor
public class ProjectStatusController {

  private final ProjectStatusService service;

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

  /** 상태 이름 변경. */
  @PatchMapping("/{statusId}")
  @RequirePermission("project:manage")
  public ResponseEntity<ProjectStatusResponse> rename(
      Authentication auth,
      @PathVariable String key,
      @PathVariable Long statusId,
      @Valid @RequestBody RenameProjectStatusRequest req) {
    return ResponseEntity.ok(service.rename((Long) auth.getPrincipal(), key, statusId, req));
  }
}
