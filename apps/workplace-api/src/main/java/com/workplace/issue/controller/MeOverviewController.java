package com.workplace.issue.controller;

import com.workplace.issue.dto.MeDaySummary;
import com.workplace.issue.dto.MeOverviewPeriod;
import com.workplace.issue.dto.MeOverviewResponse;
import com.workplace.issue.metrics.MetricsGranularity;
import com.workplace.issue.service.MeOverviewService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * 「내 작업 · 개요」 탭 API(WP-1484). 인증만 필요하고 추가 권한은 없다 — 언제나 호출자 본인 것만 낸다(사용자 id 파라미터가 없어 관리자도 남의 개요를 볼 수
 * 없다).
 */
@RestController
@RequiredArgsConstructor
public class MeOverviewController {

  private final MeOverviewService service;

  /**
   * GET /api/v1/me/overview — 개요 한 화면 전체(어제/오늘, 숫자 넷, 추이, 기한 준수, 앞으로 할 일, 끝낸 일). 모르는 기간·단위 값은 400.
   *
   * @param period WEEK(이번 주) / MONTH(이번 달, 기본) / QUARTER(최근 3개월)
   * @param granularity 추이 칸 단위 DAY(기본) / WEEK / MONTH
   */
  @GetMapping("/api/v1/me/overview")
  public ResponseEntity<MeOverviewResponse> overview(
      Authentication auth,
      @RequestParam(defaultValue = "MONTH") MeOverviewPeriod period,
      @RequestParam(defaultValue = "DAY") MetricsGranularity granularity) {
    return ResponseEntity.ok(service.overview((Long) auth.getPrincipal(), period, granularity));
  }

  /** GET /api/v1/me/overview/today — 「어제/오늘」 요약만. 홈 「내 작업」 위젯 한 줄이 개요 전체를 부르지 않도록 따로 둔다. */
  @GetMapping("/api/v1/me/overview/today")
  public ResponseEntity<MeDaySummary> today(Authentication auth) {
    return ResponseEntity.ok(service.today((Long) auth.getPrincipal()));
  }
}
