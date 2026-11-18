package com.workplace.drive.controller;

import com.workplace.drive.dto.DriveRecentPageResponse;
import com.workplace.drive.service.DriveRecentService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** 드라이브 「최근」 API(WP-1699) — 내가 열거나 올린 파일 목록. 인증 필요, 늘 내 기록만 준다(남의 user id 를 받지 않는다). */
@RestController
@RequiredArgsConstructor
@RequestMapping("/api/v1/drive/recent")
public class DriveRecentController {
  private final DriveRecentService service;

  /** 최근 순 한 쪽. cursor 는 직전 응답의 nextCursor, limit 기본 50(1~50). */
  @GetMapping
  public ResponseEntity<DriveRecentPageResponse> list(
      @AuthenticationPrincipal Long callerId,
      @RequestParam(name = "cursor", required = false) String cursor,
      @RequestParam(name = "limit", required = false) Integer limit) {
    return ResponseEntity.ok(service.list(callerId, cursor, limit));
  }
}
