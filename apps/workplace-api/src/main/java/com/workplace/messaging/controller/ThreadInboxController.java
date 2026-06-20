package com.workplace.messaging.controller;

import com.workplace.messaging.dto.ThreadInboxPage;
import com.workplace.messaging.service.ThreadInboxService;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** 크로스채널 Threads 인박스 조회(읽기 전용). 읽음 처리는 1단계 thread/read 재사용. */
@RestController
@RequiredArgsConstructor
@RequestMapping("/api/v1/messaging/threads/inbox")
public class ThreadInboxController {

  private final ThreadInboxService inboxService;

  /** 미읽음 스레드 목록(활동순, keyset). */
  @GetMapping
  public ResponseEntity<ThreadInboxPage> inbox(
      @AuthenticationPrincipal Long callerId,
      @RequestParam(required = false) String cursor,
      @RequestParam(defaultValue = "50") int limit) {
    return ResponseEntity.ok(inboxService.inbox(callerId, cursor, limit));
  }

  /** 미읽음 스레드 개수(뱃지). */
  @GetMapping("/unread-count")
  public ResponseEntity<Map<String, Long>> unreadCount(@AuthenticationPrincipal Long callerId) {
    return ResponseEntity.ok(Map.of("count", inboxService.unreadThreadCount(callerId)));
  }
}
