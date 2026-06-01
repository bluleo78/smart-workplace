package com.workplace.messaging.controller;

import com.workplace.messaging.dto.CreateMessageRequest;
import com.workplace.messaging.dto.MessagePage;
import com.workplace.messaging.dto.MessageResponse;
import com.workplace.messaging.service.MessageService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
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
}
