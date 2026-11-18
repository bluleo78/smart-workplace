package com.workplace.drive.controller;

import com.workplace.drive.dto.DriveStarRequest;
import com.workplace.drive.dto.DriveStarredPage;
import com.workplace.drive.service.DriveStarService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

/**
 * 드라이브 「별표」 API(WP-1698) — 파일·폴더 별표 넣기·빼기와 내 별표 목록. 인증 필요, 늘 로그인한 사람 자신의 별표만 다룬다(다른 사람 id 를 받는 인자가
 * 없다). 넣기·빼기 모두 본문 {@code {kind, id}} 하나로 받는다.
 */
@RestController
@RequiredArgsConstructor
@RequestMapping("/api/v1/drive")
public class DriveStarController {
  private final DriveStarService service;

  /** 별표 넣기 → 204. 이미 있어도 204(멱등). 볼 수 없거나 없는 항목은 같은 404, kind 누락·잘못된 값은 400. */
  @PutMapping("/stars")
  public ResponseEntity<Void> star(
      @AuthenticationPrincipal Long callerId, @Valid @RequestBody DriveStarRequest req) {
    service.star(callerId, req.folder(), req.id());
    return ResponseEntity.noContent().build();
  }

  /** 별표 빼기 → 204. 별표가 없거나 볼 수 없는 항목이어도 204(멱등 — 내 행만 지운다). */
  @DeleteMapping("/stars")
  public ResponseEntity<Void> unstar(
      @AuthenticationPrincipal Long callerId, @Valid @RequestBody DriveStarRequest req) {
    service.unstar(callerId, req.folder(), req.id());
    return ResponseEntity.noContent().build();
  }

  /** 내 별표 목록 한 페이지(별표한 순). cursor 는 앞 페이지의 nextCursor. */
  @GetMapping("/starred")
  public ResponseEntity<DriveStarredPage> list(
      @AuthenticationPrincipal Long callerId,
      @RequestParam(value = "cursor", required = false) String cursor) {
    return ResponseEntity.ok(service.list(callerId, cursor));
  }
}
