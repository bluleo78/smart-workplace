package com.workplace.home.controller;

import com.workplace.home.service.HomeActivityService;
import lombok.RequiredArgsConstructor;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** GET /api/v1/me/activity — 내 담당/워치 이슈의 최근 활동(읽기 전용). */
@RestController
@RequiredArgsConstructor
@RequestMapping("/api/v1/me/activity")
public class HomeActivityController {
  private final HomeActivityService activityService;

  @GetMapping
  public HomeActivityService.Page list(
      @AuthenticationPrincipal Long callerId,
      @RequestParam(required = false) String actorKind,
      @RequestParam(required = false) String cursor,
      @RequestParam(defaultValue = "20") int size) {
    return activityService.recent(callerId, actorKind, cursor, size);
  }
}
