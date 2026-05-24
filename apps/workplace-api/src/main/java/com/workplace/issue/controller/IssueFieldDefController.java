package com.workplace.issue.controller;

import com.workplace.global.security.RequirePermission;
import com.workplace.issue.dto.CreateIssueFieldDefRequest;
import com.workplace.issue.dto.IssueFieldDefResponse;
import com.workplace.issue.service.IssueFieldDefService;
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

/** Phase 4c — 프로젝트 custom field 정의 CRUD. 조회는 멤버(project:read), 변경은 OWNER(project:manage). */
@RestController
@RequestMapping("/api/v1/projects/{key}/fields")
@RequiredArgsConstructor
public class IssueFieldDefController {

  private final IssueFieldDefService service;

  /** 프로젝트 내 필드 정의 목록. */
  @GetMapping
  @RequirePermission("project:read")
  public ResponseEntity<List<IssueFieldDefResponse>> list(
      Authentication auth, @PathVariable String key) {
    return ResponseEntity.ok(service.list((Long) auth.getPrincipal(), key));
  }

  /** 필드 정의 신규 생성. */
  @PostMapping
  @RequirePermission("project:manage")
  public ResponseEntity<IssueFieldDefResponse> create(
      Authentication auth,
      @PathVariable String key,
      @Valid @RequestBody CreateIssueFieldDefRequest req) {
    return ResponseEntity.ok(service.create((Long) auth.getPrincipal(), key, req));
  }

  /** 필드 정의 수정 — type 변경은 차단. */
  @PatchMapping("/{fieldId}")
  @RequirePermission("project:manage")
  public ResponseEntity<IssueFieldDefResponse> update(
      Authentication auth,
      @PathVariable String key,
      @PathVariable Long fieldId,
      @Valid @RequestBody CreateIssueFieldDefRequest req) {
    return ResponseEntity.ok(service.update((Long) auth.getPrincipal(), key, fieldId, req));
  }

  /** 필드 정의 삭제 — 값들은 FK cascade 로 함께 제거. */
  @DeleteMapping("/{fieldId}")
  @RequirePermission("project:manage")
  public ResponseEntity<Void> delete(
      Authentication auth, @PathVariable String key, @PathVariable Long fieldId) {
    service.delete((Long) auth.getPrincipal(), key, fieldId);
    return ResponseEntity.noContent().build();
  }
}
