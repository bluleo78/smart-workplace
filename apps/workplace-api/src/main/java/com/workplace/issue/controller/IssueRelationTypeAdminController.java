package com.workplace.issue.controller;

import com.workplace.global.security.RequirePermission;
import com.workplace.issue.dto.IssueRelationTypeAdminResponse;
import com.workplace.issue.dto.IssueRelationTypeResponse;
import com.workplace.issue.dto.SaveIssueRelationTypeRequest;
import com.workplace.issue.dto.SetIssueRelationTypeHiddenRequest;
import com.workplace.issue.service.IssueRelationTypeService;
import jakarta.validation.Valid;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * 이슈 관계 유형 관리자 API(WP-887) — 설정 › 작업 관리 › 관계 유형 화면이 부른다. 모두 {@code issue_relation_type:manage} 권한이
 * 있어야 한다(시스템 ADMIN 역할).
 */
@RestController
@RequiredArgsConstructor
@RequestMapping("/api/v1/admin/issue-relation-types")
@RequirePermission("issue_relation_type:manage")
public class IssueRelationTypeAdminController {

  private final IssueRelationTypeService service;

  /** 유형 목록 + 유형별 사용 건수(내부 관계·외부 링크). */
  @GetMapping
  public ResponseEntity<List<IssueRelationTypeAdminResponse>> list() {
    return ResponseEntity.ok(service.listForAdmin());
  }

  /** 사용자 정의 유형 추가. */
  @PostMapping
  public ResponseEntity<IssueRelationTypeResponse> create(
      Authentication auth, @Valid @RequestBody SaveIssueRelationTypeRequest req) {
    return ResponseEntity.ok(service.create((Long) auth.getPrincipal(), req));
  }

  /** 이름·말·방향 편집(사용자 정의 유형만). */
  @PutMapping("/{id}")
  public ResponseEntity<IssueRelationTypeResponse> update(
      Authentication auth,
      @PathVariable long id,
      @Valid @RequestBody SaveIssueRelationTypeRequest req) {
    return ResponseEntity.ok(service.update((Long) auth.getPrincipal(), id, req));
  }

  /** 숨김 켜고 끄기(차단 불가). */
  @PutMapping("/{id}/hidden")
  public ResponseEntity<IssueRelationTypeResponse> setHidden(
      Authentication auth,
      @PathVariable long id,
      @Valid @RequestBody SetIssueRelationTypeHiddenRequest req) {
    return ResponseEntity.ok(service.setHidden((Long) auth.getPrincipal(), id, req.hidden()));
  }

  /** 사용자 정의 유형 삭제(204) — 사용 중이면 {@code moveTo} 또는 {@code deleteLinks=true} 가 필요하다(없으면 409). */
  @DeleteMapping("/{id}")
  public ResponseEntity<Void> delete(
      Authentication auth,
      @PathVariable long id,
      @RequestParam(name = "moveTo", required = false) Long moveTo,
      @RequestParam(name = "deleteLinks", defaultValue = "false") boolean deleteLinks) {
    service.delete((Long) auth.getPrincipal(), id, moveTo, deleteLinks);
    return ResponseEntity.noContent().build();
  }
}
