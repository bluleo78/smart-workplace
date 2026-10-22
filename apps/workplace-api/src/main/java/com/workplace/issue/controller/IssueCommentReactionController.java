package com.workplace.issue.controller;

import com.workplace.global.security.RequirePermission;
import com.workplace.issue.dto.CommentReactionRequest;
import com.workplace.issue.dto.CommentReactorPage;
import com.workplace.issue.service.IssueCommentReactionService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * 이슈 코멘트 이모지 반응 REST API(WP-504). 채팅 ReactionController 와 같은 모양 — 추가=POST(body emoji),
 * 취소=DELETE(query emoji) 모두 204, 반응자 조회=GET(지연 로딩).
 */
@RestController
@RequestMapping("/api/v1/issues/{issueId}/comments/{commentId}/reactions")
@RequiredArgsConstructor
public class IssueCommentReactionController {

  private final IssueCommentReactionService reactionService;

  /** 반응 추가(멱등). */
  @PostMapping
  @RequirePermission("issue:write")
  public ResponseEntity<Void> add(
      Authentication auth,
      @PathVariable long issueId,
      @PathVariable long commentId,
      @Valid @RequestBody CommentReactionRequest req) {
    reactionService.add((Long) auth.getPrincipal(), issueId, commentId, req.emoji());
    return ResponseEntity.noContent().build();
  }

  /** 반응 취소(멱등). */
  @DeleteMapping
  @RequirePermission("issue:write")
  public ResponseEntity<Void> remove(
      Authentication auth,
      @PathVariable long issueId,
      @PathVariable long commentId,
      @RequestParam String emoji) {
    reactionService.remove((Long) auth.getPrincipal(), issueId, commentId, emoji);
    return ResponseEntity.noContent().build();
  }

  /** 이모지별 반응자 페이지. 호버 카드·전체 보기에서만 호출 — 코멘트 목록은 개수만 싣는다. */
  @GetMapping("/users")
  @RequirePermission("project:read")
  public ResponseEntity<CommentReactorPage> listReactors(
      Authentication auth,
      @PathVariable long issueId,
      @PathVariable long commentId,
      @RequestParam(required = false) String emoji,
      @RequestParam(required = false) String cursor,
      @RequestParam(defaultValue = "20") int limit) {
    // 누락·빈값·과장(>32자) emoji 는 400 — 파라미터 제약 애노테이션은 이 프로젝트 핸들러에서 400 으로 매핑되지 않아 직접 검증한다(채팅과 같다).
    if (emoji == null || emoji.isBlank() || emoji.length() > 32)
      throw new IllegalArgumentException("emoji 가 올바르지 않습니다");
    return ResponseEntity.ok(
        reactionService.listReactors(
            (Long) auth.getPrincipal(), issueId, commentId, emoji, cursor, limit));
  }
}
