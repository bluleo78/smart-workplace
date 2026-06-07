package com.workplace.project.controller;

import com.workplace.global.dto.PageResponse;
import com.workplace.global.security.RequirePermission;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.dto.ProjectResponse;
import com.workplace.project.dto.UpdateProjectRequest;
import com.workplace.project.service.ProjectService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Min;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** 프로젝트 CRUD REST API. @Validated 로 쿼리 파라미터 Bean Validation 활성화. */
@RestController
@RequestMapping("/api/v1/projects")
@RequiredArgsConstructor
@Validated
public class ProjectController {

  private final ProjectService projectService;

  /** 사용자에게 보이는 프로젝트 목록 페이지 조회. */
  @GetMapping
  @RequirePermission("project:read")
  public ResponseEntity<PageResponse<ProjectResponse>> list(
      Authentication auth,
      @Min(value = 0, message = "page는 0 이상이어야 합니다") @RequestParam(defaultValue = "0") int page,
      @Min(value = 1, message = "size는 1 이상이어야 합니다") @RequestParam(defaultValue = "20") int size) {
    return ResponseEntity.ok(projectService.list((Long) auth.getPrincipal(), page, size));
  }

  /** 프로젝트 생성. */
  @PostMapping
  @RequirePermission("project:write")
  public ResponseEntity<ProjectResponse> create(
      Authentication auth, @Valid @RequestBody CreateProjectRequest req) {
    return ResponseEntity.ok(projectService.create((Long) auth.getPrincipal(), req));
  }

  /** key 로 단일 프로젝트 조회. */
  @GetMapping("/{key}")
  @RequirePermission("project:read")
  public ResponseEntity<ProjectResponse> get(Authentication auth, @PathVariable String key) {
    return ResponseEntity.ok(projectService.get((Long) auth.getPrincipal(), key));
  }

  /** 프로젝트 이름/설명 수정. */
  @PatchMapping("/{key}")
  @RequirePermission("project:write")
  public ResponseEntity<ProjectResponse> update(
      Authentication auth, @PathVariable String key, @Valid @RequestBody UpdateProjectRequest req) {
    return ResponseEntity.ok(projectService.update((Long) auth.getPrincipal(), key, req));
  }

  /** 프로젝트 soft-delete. OWNER 만 가능. */
  @DeleteMapping("/{key}")
  @RequirePermission("project:manage")
  public ResponseEntity<Void> delete(Authentication auth, @PathVariable String key) {
    projectService.softDelete((Long) auth.getPrincipal(), key);
    return ResponseEntity.noContent().build();
  }
}
