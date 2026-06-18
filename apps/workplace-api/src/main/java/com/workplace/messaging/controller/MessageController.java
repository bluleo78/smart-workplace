package com.workplace.messaging.controller;

import com.workplace.messaging.dto.CreateMessageRequest;
import com.workplace.messaging.dto.MarkReadRequest;
import com.workplace.messaging.dto.MessagePage;
import com.workplace.messaging.dto.MessageResponse;
import com.workplace.messaging.dto.MessagingProgressRequest;
import com.workplace.messaging.dto.UpdateMessageRequest;
import com.workplace.messaging.service.MessageService;
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

/** 채널 메시지 조회/작성. */
@RestController
@RequiredArgsConstructor
@RequestMapping("/api/v1/messaging")
public class MessageController {

  private final MessageService messageService;

  @GetMapping("/channels/{id}/messages")
  public ResponseEntity<MessagePage> list(
      @AuthenticationPrincipal Long callerId,
      @PathVariable("id") long channelId,
      @RequestParam(required = false) String cursor,
      @RequestParam(defaultValue = "50") int limit) {
    return ResponseEntity.ok(messageService.list(callerId, channelId, cursor, limit));
  }

  @PostMapping("/channels/{id}/messages")
  public ResponseEntity<MessageResponse> create(
      @AuthenticationPrincipal Long callerId,
      @PathVariable("id") long channelId,
      @Valid @RequestBody CreateMessageRequest req) {
    return ResponseEntity.status(HttpStatus.CREATED)
        .body(messageService.create(callerId, channelId, req));
  }

  /** 작성자만 자신의 메시지 수정. 403 = 다른 작성자, 404 = 미존재. */
  @PatchMapping("/messages/{id}")
  public ResponseEntity<MessageResponse> update(
      @AuthenticationPrincipal Long callerId,
      @PathVariable("id") long messageId,
      @Valid @RequestBody UpdateMessageRequest req) {
    return ResponseEntity.ok(messageService.update(callerId, messageId, req));
  }

  /** 채널 멤버가 uptoMessageId 까지 읽음 표시. 204 반환. 비멤버=403. */
  @PostMapping("/channels/{id}/read")
  public ResponseEntity<Void> markRead(
      @AuthenticationPrincipal Long callerId,
      @PathVariable("id") long channelId,
      @Valid @RequestBody MarkReadRequest req) {
    messageService.markRead(callerId, channelId, req.uptoMessageId());
    return ResponseEntity.noContent().build();
  }

  /** 특정 부모 메시지의 답글(스레드) 조회. 비멤버=403. */
  @GetMapping("/messages/{id}/replies")
  public ResponseEntity<MessagePage> replies(
      @AuthenticationPrincipal Long callerId,
      @PathVariable("id") long parentMessageId,
      @RequestParam(required = false) String cursor,
      @RequestParam(defaultValue = "50") int limit) {
    return ResponseEntity.ok(messageService.listThread(callerId, parentMessageId, cursor, limit));
  }

  /** 작성자만 자신의 메시지 soft-delete. 204 반환. */
  @DeleteMapping("/messages/{id}")
  public ResponseEntity<Void> delete(
      @AuthenticationPrincipal Long callerId, @PathVariable("id") long messageId) {
    messageService.delete(callerId, messageId);
    return ResponseEntity.noContent().build();
  }

  /** 진행 알림 — DB 변경 없이 채널 멤버에게 SSE progress 이벤트 발행. ai-agent 전용(Internal+X-On-Behalf-Of). */
  @PostMapping("/channels/{id}/progress")
  public ResponseEntity<Void> progress(
      @AuthenticationPrincipal Long callerId,
      @PathVariable("id") long channelId,
      @RequestBody MessagingProgressRequest req) {
    messageService.notifyProgress(callerId, channelId, req.streamId(), req.phase(), req.steps());
    return ResponseEntity.noContent().build();
  }
}
