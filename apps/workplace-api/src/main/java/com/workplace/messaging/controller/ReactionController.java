package com.workplace.messaging.controller;

import com.workplace.messaging.dto.ReactionRequest;
import com.workplace.messaging.dto.ReactorPage;
import com.workplace.messaging.service.ReactionService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** 메시지 이모지 리액션 토글. 추가=POST(body emoji), 제거=DELETE(query emoji) 모두 204. 반응자 조회=GET(지연 로딩). */
@RestController
@RequiredArgsConstructor
@RequestMapping("/api/v1/messaging")
public class ReactionController {

  private final ReactionService reactionService;

  @PostMapping("/messages/{id}/reactions")
  public ResponseEntity<Void> add(
      @AuthenticationPrincipal Long callerId,
      @PathVariable("id") long messageId,
      @Valid @RequestBody ReactionRequest req) {
    reactionService.add(callerId, messageId, req.emoji());
    return ResponseEntity.noContent().build();
  }

  @DeleteMapping("/messages/{id}/reactions")
  public ResponseEntity<Void> remove(
      @AuthenticationPrincipal Long callerId,
      @PathVariable("id") long messageId,
      @RequestParam String emoji) {
    reactionService.remove(callerId, messageId, emoji);
    return ResponseEntity.noContent().build();
  }

  /** 이모지별 반응자 페이지(WP-106). 호버 카드·전체 보기에서만 호출 — 메시지 목록은 개수만 싣는다. */
  @GetMapping("/messages/{id}/reactions/users")
  public ResponseEntity<ReactorPage> listReactors(
      @AuthenticationPrincipal Long callerId,
      @PathVariable("id") long messageId,
      @RequestParam(required = false) String emoji,
      @RequestParam(required = false) String cursor,
      @RequestParam(defaultValue = "20") int limit) {
    // 누락·빈값·과장(>32자) emoji 는 400 — 파라미터 제약 애노테이션은 이 프로젝트 핸들러에서 400 으로 매핑되지 않아 직접 검증한다.
    if (emoji == null || emoji.isBlank() || emoji.length() > 32)
      throw new IllegalArgumentException("emoji 가 올바르지 않습니다");
    return ResponseEntity.ok(
        reactionService.listReactors(callerId, messageId, emoji, cursor, limit));
  }
}
