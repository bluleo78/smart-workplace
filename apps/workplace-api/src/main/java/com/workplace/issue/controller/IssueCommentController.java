package com.workplace.issue.controller;

import com.workplace.global.security.RequirePermission;
import com.workplace.issue.dto.CreateCommentRequest;
import com.workplace.issue.dto.IssueCommentResponse;
import com.workplace.issue.dto.UpdateCommentRequest;
import com.workplace.issue.service.IssueCommentService;
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

/** 이슈 코멘트 CRUD REST API. issueId 기준 경로. */
@RestController
@RequestMapping("/api/v1/issues/{issueId}/comments")
@RequiredArgsConstructor
public class IssueCommentController {

  private final IssueCommentService commentService;

  /** 이슈 코멘트 목록 조회. */
  @GetMapping
  @RequirePermission("project:read")
  public ResponseEntity<List<IssueCommentResponse>> list(
      Authentication auth, @PathVariable Long issueId) {
    return ResponseEntity.ok(commentService.list((Long) auth.getPrincipal(), issueId));
  }

  /** 코멘트 생성. */
  @PostMapping
  @RequirePermission("issue:write")
  public ResponseEntity<IssueCommentResponse> create(
      Authentication auth,
      @PathVariable Long issueId,
      @Valid @RequestBody CreateCommentRequest req) {
    return ResponseEntity.ok(commentService.create((Long) auth.getPrincipal(), issueId, req));
  }

  /** 코멘트 수정 (본인 작성분만). */
  @PatchMapping("/{commentId}")
  @RequirePermission("issue:write")
  public ResponseEntity<IssueCommentResponse> update(
      Authentication auth,
      @PathVariable Long issueId,
      @PathVariable Long commentId,
      @Valid @RequestBody UpdateCommentRequest req) {
    return ResponseEntity.ok(
        commentService.update((Long) auth.getPrincipal(), issueId, commentId, req));
  }

  /** 코멘트 soft-delete (본인 또는 OWNER). */
  @DeleteMapping("/{commentId}")
  @RequirePermission("issue:write")
  public ResponseEntity<Void> delete(
      Authentication auth, @PathVariable Long issueId, @PathVariable Long commentId) {
    commentService.delete((Long) auth.getPrincipal(), issueId, commentId);
    return ResponseEntity.noContent().build();
  }
}
