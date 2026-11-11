package com.workplace.issue.profile;

import com.workplace.issue.dto.MeOverviewPeriod;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * 「내 작업 · 개요」 업무 프로파일 카드 API(WP-1485). 인증만 필요하고 언제나 호출자 본인 것만 다룬다 — 사용자 id 파라미터를 받지 않아 남의 프로파일을 보거나
 * 남의 AI 분석을 일으킬 길이 없다.
 */
@RestController
@RequiredArgsConstructor
public class WorkProfileController {

  private final WorkProfileService service;

  /**
   * GET /api/v1/me/work-profile — 저장된 프로파일. 행이 없고 끝낸 이슈가 있으면 분석을 시작하며 PENDING 으로 답한다. 모르는 기간 값은
   * 400.
   *
   * @param period WEEK / MONTH(기본) / QUARTER
   */
  @GetMapping("/api/v1/me/work-profile")
  public ResponseEntity<WorkProfileResponse> get(
      Authentication auth, @RequestParam(defaultValue = "MONTH") MeOverviewPeriod period) {
    return ResponseEntity.ok(service.get((Long) auth.getPrincipal(), period));
  }

  /** POST /api/v1/me/work-profile/analyze — 「다시 분석」. 하루 상한(10번)을 넘으면 429. */
  @PostMapping("/api/v1/me/work-profile/analyze")
  public ResponseEntity<WorkProfileAnalyzeResponse> analyze(
      Authentication auth, @RequestParam(defaultValue = "MONTH") MeOverviewPeriod period) {
    return ResponseEntity.ok(service.analyze((Long) auth.getPrincipal(), period));
  }
}
