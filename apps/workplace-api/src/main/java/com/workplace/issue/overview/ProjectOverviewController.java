package com.workplace.issue.overview;

import com.workplace.global.security.RequirePermission;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RestController;

/**
 * 프로젝트 「개요」 탭 API(WP-1478). 위젯마다 따로 부르지 않고 한 번에 받는다 — 탭을 열 때 요청 하나, 「살펴볼 이슈」 타일 전환도 다시 묻지 않는다.
 * 프로젝트를 읽을 수 있는 사람만(못 읽으면 존재를 드러내지 않는 404).
 */
@RestController
@RequiredArgsConstructor
public class ProjectOverviewController {

  private final ProjectOverviewService service;

  /** GET /api/v1/projects/{key}/overview — 개요 한 화면 전체(응답 모양은 {@link ProjectOverviewResponse}). */
  @GetMapping("/api/v1/projects/{key}/overview")
  @RequirePermission("project:read")
  public ResponseEntity<ProjectOverviewResponse> overview(
      Authentication auth, @PathVariable String key) {
    return ResponseEntity.ok(service.overview((Long) auth.getPrincipal(), key));
  }
}
