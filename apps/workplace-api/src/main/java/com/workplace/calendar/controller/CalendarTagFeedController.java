package com.workplace.calendar.controller;

import com.workplace.calendar.dto.TagFeedResponse;
import com.workplace.calendar.service.CalendarTagFeedService;
import com.workplace.global.security.RequirePermission;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 태그 구독 주소 관리 API(WP-715) — 내 태그의 비밀 iCal 주소 조회·발급(재발급)·폐기. 공개 피드 자체는 {@link
 * PublicCalendarFeedController}.
 */
@RestController
@RequiredArgsConstructor
@RequestMapping("/api/v1/calendar/tags/{id}/feed")
@RequirePermission("calendar:read")
public class CalendarTagFeedController {
  private final CalendarTagFeedService service;

  /** 구독 주소 — 없으면 404. */
  @GetMapping
  public ResponseEntity<TagFeedResponse> get(
      @AuthenticationPrincipal Long callerId, @PathVariable long id) {
    return ResponseEntity.ok(service.get(callerId, id));
  }

  /** 발급·재발급 — 이전 주소는 바로 막힌다. */
  @PostMapping
  @RequirePermission("calendar:write")
  public ResponseEntity<TagFeedResponse> create(
      @AuthenticationPrincipal Long callerId, @PathVariable long id) {
    return ResponseEntity.ok(service.create(callerId, id));
  }

  /** 폐기. */
  @DeleteMapping
  @RequirePermission("calendar:write")
  public ResponseEntity<Void> delete(
      @AuthenticationPrincipal Long callerId, @PathVariable long id) {
    service.delete(callerId, id);
    return ResponseEntity.noContent().build();
  }
}
