package com.workplace.issue.controller;

import com.workplace.global.security.RequirePermission;
import com.workplace.issue.dto.CreateIssueTypeRequest;
import com.workplace.issue.dto.IssueTypeResponse;
import com.workplace.issue.service.IssueTypeService;
import jakarta.validation.Valid;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** 프로젝트 이슈 유형 정의 CRUD REST API. 조회는 멤버(`project:read`), 변경은 OWNER(`project:manage`). */
@RestController
@RequestMapping("/api/v1/projects/{key}/types")
@RequiredArgsConstructor
public class IssueTypeController {

  private final IssueTypeService service;

  /** 프로젝트 내 유형 목록 조회. */
  @GetMapping
  @RequirePermission("project:read")
  public ResponseEntity<List<IssueTypeResponse>> list(
      Authentication auth, @PathVariable String key) {
    return ResponseEntity.ok(service.list((Long) auth.getPrincipal(), key));
  }

  /** CUSTOM 유형 생성. */
  @PostMapping
  @RequirePermission("project:manage")
  public ResponseEntity<IssueTypeResponse> create(
      Authentication auth,
      @PathVariable String key,
      @Valid @RequestBody CreateIssueTypeRequest req) {
    return ResponseEntity.ok(service.create((Long) auth.getPrincipal(), key, req));
  }

  /** CUSTOM 유형 수정 — 시스템 유형은 차단. */
  @PatchMapping("/{typeId}")
  @RequirePermission("project:manage")
  public ResponseEntity<IssueTypeResponse> update(
      Authentication auth,
      @PathVariable String key,
      @PathVariable Long typeId,
      @Valid @RequestBody CreateIssueTypeRequest req) {
    return ResponseEntity.ok(service.update((Long) auth.getPrincipal(), key, typeId, req));
  }

  /** CUSTOM 유형 삭제 — 사용 중이거나 시스템이면 차단. */
  @DeleteMapping("/{typeId}")
  @RequirePermission("project:manage")
  public ResponseEntity<Void> delete(
      Authentication auth, @PathVariable String key, @PathVariable Long typeId) {
    service.delete((Long) auth.getPrincipal(), key, typeId);
    return ResponseEntity.noContent().build();
  }
}
