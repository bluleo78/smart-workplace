package com.workplace.home.controller;

import com.workplace.home.dto.ConversationSearchResponse;
import com.workplace.home.dto.HomeMessageResponse;
import com.workplace.home.dto.HomeSessionResponse;
import com.workplace.home.service.HomeConversationSearchService;
import com.workplace.home.service.HomeSessionService;
import java.util.List;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** 홈 AI Chat 세션 — 목록/생성/복원/삭제. */
@RestController
@RequiredArgsConstructor
@RequestMapping("/api/v1/home/sessions")
public class HomeSessionController {
  private final HomeSessionService sessionService;
  private final HomeConversationSearchService searchService;

  /** 새 세션 생성. */
  @PostMapping
  public ResponseEntity<HomeSessionResponse> create(@AuthenticationPrincipal Long callerId) {
    return ResponseEntity.status(HttpStatus.CREATED).body(sessionService.create(callerId));
  }

  /** 세션 목록 조회 (커서 페이징). */
  @GetMapping
  public HomeSessionService.Page list(
      @AuthenticationPrincipal Long callerId,
      @RequestParam(required = false) String cursor,
      @RequestParam(defaultValue = "30") int size) {
    return sessionService.list(callerId, cursor, size);
  }

  /**
   * 지난 대화 검색(WP-384) — ai-agent search_conversations 가 요청자 대행으로 부른다. 본인 대화만, 지금
   * 대화(excludeSessionId) 제외, 꺼짐이면 memoryEnabled=false. 경로가 {@code /{id}} 보다 구체적이라 DELETE {@code
   * /{id}} 와 겹치지 않는다.
   */
  @GetMapping("/search")
  public ConversationSearchResponse search(
      @AuthenticationPrincipal Long callerId,
      @RequestParam(value = "q", required = false) String q,
      @RequestParam(value = "excludeSessionId", required = false) UUID excludeSessionId,
      @RequestParam(value = "limit", required = false) Integer limit) {
    return searchService.search(callerId, q, excludeSessionId, limit);
  }

  /** 세션 메시지 목록 조회. */
  @GetMapping("/{id}/messages")
  public List<HomeMessageResponse> messages(
      @AuthenticationPrincipal Long callerId, @PathVariable UUID id) {
    return sessionService.getMessages(callerId, id);
  }

  /** 세션 삭제. */
  @DeleteMapping("/{id}")
  public ResponseEntity<Void> delete(
      @AuthenticationPrincipal Long callerId, @PathVariable UUID id) {
    sessionService.delete(callerId, id);
    return ResponseEntity.noContent().build();
  }
}
