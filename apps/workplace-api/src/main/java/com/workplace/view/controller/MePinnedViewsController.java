package com.workplace.view.controller;

import com.workplace.view.dto.PinnedSavedViewResponse;
import com.workplace.view.service.MePinnedViewService;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/** 사용자의 고정뷰(프로젝트 교차) — 사이드바 전역 섹션. /me/* 관례대로 인증만. */
@RestController
@RequiredArgsConstructor
public class MePinnedViewsController {

  private final MePinnedViewService service;

  @GetMapping("/api/v1/me/pinned-views")
  public ResponseEntity<List<PinnedSavedViewResponse>> list(
      @AuthenticationPrincipal Long callerId) {
    return ResponseEntity.ok(service.list(callerId));
  }
}
