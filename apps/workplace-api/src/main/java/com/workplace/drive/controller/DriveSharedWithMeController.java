package com.workplace.drive.controller;

import com.workplace.drive.dto.SharedWithMeItemResponse;
import com.workplace.drive.service.DriveSharedWithMeService;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

/** 「공유받은 항목」 API(WP-1539) — 내가 연 사내 공유 링크 목록과 내 목록에서 빼기. 인증 필요, 늘 내 행만 다룬다. */
@RestController
@RequiredArgsConstructor
@RequestMapping("/api/v1/drive/shared-with-me")
public class DriveSharedWithMeController {
  private final DriveSharedWithMeService service;

  /** 내 공유받은 항목(마지막으로 연 순). */
  @GetMapping
  public ResponseEntity<List<SharedWithMeItemResponse>> list(
      @AuthenticationPrincipal Long callerId) {
    return ResponseEntity.ok(service.list(callerId));
  }

  /** 목록에서 빼기 → 204. 내 행이 없어도 204(멱등 — 남의 기록 존재 여부를 드러내지 않는다). 링크 권한은 그대로다. */
  @DeleteMapping("/{shareLinkId}")
  public ResponseEntity<Void> hide(
      @AuthenticationPrincipal Long callerId, @PathVariable("shareLinkId") long shareLinkId) {
    service.hide(callerId, shareLinkId);
    return ResponseEntity.noContent().build();
  }
}
