package com.workplace.wiki.controller;

import com.workplace.wiki.dto.WikiRecentPageResponse;
import com.workplace.wiki.service.WikiRecentService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** 노트 「최근」(WP-1764) — 내가 열거나 고친 노트를 공간을 가로질러 최근 순으로. */
@RestController
@RequiredArgsConstructor
@RequestMapping("/api/v1/wiki/recent")
public class WikiRecentController {
  private final WikiRecentService service;

  /** 내 최근 한 쪽. cursor 는 이전 응답의 nextCursor, limit 은 1~50(기본 50). 깨진 cursor 는 400. */
  @GetMapping
  public ResponseEntity<WikiRecentPageResponse> recent(
      @AuthenticationPrincipal Long callerId,
      @RequestParam(value = "cursor", required = false) String cursor,
      @RequestParam(value = "limit", required = false) Integer limit) {
    return ResponseEntity.ok(service.list(callerId, cursor, limit));
  }
}
