package com.workplace.chat.controller;

import com.workplace.chat.dto.ChatMessagePage;
import com.workplace.chat.dto.ChatMessageResponse;
import com.workplace.chat.dto.CreateChatMessageRequest;
import com.workplace.chat.dto.MarkChatReadRequest;
import com.workplace.chat.dto.UpdateChatMessageRequest;
import com.workplace.chat.service.ChatMessageService;
import com.workplace.global.dto.AiProgressRequest;
import com.workplace.global.security.InternalOnBehalfOf;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** chat message CRUD + paging + 읽음 표시. */
@RestController
@RequiredArgsConstructor
@RequestMapping("/api/v1/chat")
public class ChatMessageController {

  private final ChatMessageService messageService;

  /** 메시지 목록 — cursor(이전 페이지)·after(그 뒤)·afterMine(내 마지막 글 기준) 중 하나(WP-373). */
  @GetMapping("/threads/{id}/messages")
  public ResponseEntity<ChatMessagePage> list(
      @AuthenticationPrincipal Long callerId,
      @PathVariable("id") long threadId,
      @RequestParam(required = false) String cursor,
      @RequestParam(required = false) Long after,
      @RequestParam(defaultValue = "false") boolean afterMine,
      @RequestParam(required = false) Integer limit) {
    return ResponseEntity.ok(
        messageService.list(callerId, threadId, cursor, after, afterMine, limit));
  }

  @PostMapping("/threads/{id}/messages")
  public ResponseEntity<ChatMessageResponse> create(
      @AuthenticationPrincipal Long callerId,
      @PathVariable("id") long threadId,
      @Valid @RequestBody CreateChatMessageRequest req) {
    return ResponseEntity.status(HttpStatus.CREATED)
        .body(messageService.create(callerId, threadId, req));
  }

  @PatchMapping("/messages/{id}")
  public ResponseEntity<ChatMessageResponse> update(
      @AuthenticationPrincipal Long callerId,
      @PathVariable("id") long messageId,
      @Valid @RequestBody UpdateChatMessageRequest req) {
    return ResponseEntity.ok(messageService.update(callerId, messageId, req));
  }

  @DeleteMapping("/messages/{id}")
  public ResponseEntity<Void> delete(
      @AuthenticationPrincipal Long callerId, @PathVariable("id") long messageId) {
    messageService.delete(callerId, messageId);
    return ResponseEntity.noContent().build();
  }

  @PostMapping("/threads/{id}/read")
  public ResponseEntity<Void> markRead(
      @AuthenticationPrincipal Long callerId,
      @PathVariable("id") long threadId,
      @Valid @RequestBody MarkChatReadRequest req) {
    messageService.markRead(callerId, threadId, req.uptoMessageId());
    return ResponseEntity.noContent().build();
  }

  /** 타이핑 알림 — DB 변경 없이 thread 멤버에게 SSE typing 이벤트 발행. */
  @PostMapping("/threads/{id}/typing")
  public ResponseEntity<Void> typing(
      @AuthenticationPrincipal Long callerId, @PathVariable("id") long threadId) {
    messageService.notifyTyping(callerId, threadId);
    return ResponseEntity.noContent().build();
  }

  /**
   * 진행 알림 — DB 변경 없이 thread 멤버에게 SSE progress 이벤트 발행. ai-agent 전용(Internal+X-On-Behalf-Of).
   *
   * <p>사람 JWT·PAT·AI 키로는 403(WP-1191) — 멤버 확인만 하던 때는 사람 멤버가 이슈 채팅에 가짜 「AI 작업 중」 말풍선을 띄울 수 있었다.
   */
  @PostMapping("/threads/{id}/progress")
  public ResponseEntity<Void> progress(
      Authentication auth,
      @AuthenticationPrincipal Long callerId,
      @PathVariable("id") long threadId,
      @Valid @RequestBody AiProgressRequest req) {
    InternalOnBehalfOf.requireInternal(auth, AiProgressRequest.INTERNAL_ONLY_MESSAGE);
    messageService.notifyProgress(callerId, threadId, req.streamId(), req.phase(), req.steps());
    return ResponseEntity.noContent().build();
  }
}
