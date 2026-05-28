package com.workplace.chat.controller;

import com.workplace.chat.dto.ChatMessagePage;
import com.workplace.chat.dto.ChatMessageResponse;
import com.workplace.chat.dto.CreateChatMessageRequest;
import com.workplace.chat.dto.MarkChatReadRequest;
import com.workplace.chat.dto.UpdateChatMessageRequest;
import com.workplace.chat.service.ChatMessageService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
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

  @GetMapping("/threads/{id}/messages")
  public ResponseEntity<ChatMessagePage> list(
      @AuthenticationPrincipal Long callerId,
      @PathVariable("id") long threadId,
      @RequestParam(required = false) String cursor,
      @RequestParam(defaultValue = "50") int limit) {
    return ResponseEntity.ok(messageService.list(callerId, threadId, cursor, limit));
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
}
