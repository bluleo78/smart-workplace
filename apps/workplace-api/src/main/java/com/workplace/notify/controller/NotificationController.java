package com.workplace.notify.controller;

import com.workplace.notify.dto.NotificationResponse;
import com.workplace.notify.service.NotificationService;
import java.util.List;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * 알림 인박스 REST + SSE. 모든 엔드포인트는 본인(callerId) 스코프 — @RequirePermission 대신 recipientId=callerId 격리로 타
 * 사용자 알림 접근을 차단한다.
 */
@RestController
@RequiredArgsConstructor
@RequestMapping("/api/v1/notifications")
public class NotificationController {

  private final NotificationService service;

  /** 최신 알림 목록(평면). limit 1~100 클램프. */
  @GetMapping
  public ResponseEntity<List<NotificationResponse>> list(
      @AuthenticationPrincipal Long callerId,
      @RequestParam(name = "limit", defaultValue = "20") int limit) {
    return ResponseEntity.ok(service.listRecent(callerId, Math.min(Math.max(limit, 1), 100)));
  }

  /** 안읽음 수. */
  @GetMapping("/unread-count")
  public ResponseEntity<Map<String, Long>> unreadCount(@AuthenticationPrincipal Long callerId) {
    return ResponseEntity.ok(Map.of("count", service.countUnread(callerId)));
  }

  /** 단건 읽음. 타인 id 면 service 가 0행 — 멱등하게 204. */
  @PostMapping("/{id}/read")
  public ResponseEntity<Void> markRead(
      @AuthenticationPrincipal Long callerId, @PathVariable("id") long id) {
    service.markRead(callerId, id);
    return ResponseEntity.noContent().build();
  }

  /** 모두 읽음. */
  @PostMapping("/read-all")
  public ResponseEntity<Void> markAllRead(@AuthenticationPrincipal Long callerId) {
    service.markAllRead(callerId);
    return ResponseEntity.noContent().build();
  }
}
