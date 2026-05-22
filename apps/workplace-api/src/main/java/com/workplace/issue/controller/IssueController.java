package com.workplace.issue.controller;

import com.workplace.global.dto.PageResponse;
import com.workplace.global.security.RequirePermission;
import com.workplace.issue.dto.CreateIssueRequest;
import com.workplace.issue.dto.IssueDetailResponse;
import com.workplace.issue.dto.IssueResponse;
import com.workplace.issue.dto.UpdateIssueRequest;
import com.workplace.issue.service.IssueService;
import jakarta.validation.Valid;
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
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** 이슈 CRUD REST API. 모든 경로는 프로젝트 key 컨텍스트에 묶인다. */
@RestController
@RequestMapping("/api/v1/projects/{key}/issues")
@RequiredArgsConstructor
public class IssueController {

  private final IssueService issueService;

  /** 프로젝트 내 이슈 목록 페이지 조회. */
  @GetMapping
  @RequirePermission("project:read")
  public ResponseEntity<PageResponse<IssueResponse>> list(
      Authentication auth,
      @PathVariable String key,
      @RequestParam(defaultValue = "0") int page,
      @RequestParam(defaultValue = "20") int size) {
    return ResponseEntity.ok(issueService.list((Long) auth.getPrincipal(), key, page, size));
  }

  /** 신규 이슈 생성. */
  @PostMapping
  @RequirePermission("issue:write")
  public ResponseEntity<IssueResponse> create(
      Authentication auth, @PathVariable String key, @Valid @RequestBody CreateIssueRequest req) {
    return ResponseEntity.ok(issueService.create((Long) auth.getPrincipal(), key, req));
  }

  /** 이슈 상세 조회. */
  @GetMapping("/{number}")
  @RequirePermission("project:read")
  public ResponseEntity<IssueDetailResponse> get(
      Authentication auth, @PathVariable String key, @PathVariable int number) {
    return ResponseEntity.ok(issueService.get((Long) auth.getPrincipal(), key, number));
  }

  /** 이슈 부분 수정. */
  @PatchMapping("/{number}")
  @RequirePermission("issue:write")
  public ResponseEntity<IssueDetailResponse> update(
      Authentication auth,
      @PathVariable String key,
      @PathVariable int number,
      @Valid @RequestBody UpdateIssueRequest req) {
    return ResponseEntity.ok(issueService.update((Long) auth.getPrincipal(), key, number, req));
  }

  /** 이슈 soft-delete. reporter 또는 OWNER 만 가능. */
  @DeleteMapping("/{number}")
  @RequirePermission("issue:write")
  public ResponseEntity<Void> delete(
      Authentication auth, @PathVariable String key, @PathVariable int number) {
    issueService.softDelete((Long) auth.getPrincipal(), key, number);
    return ResponseEntity.noContent().build();
  }
}
