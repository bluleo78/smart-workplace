package com.workplace.help.controller;

import com.workplace.global.security.RequirePermission;
import com.workplace.help.dto.HelpMetricKind;
import com.workplace.help.dto.HelpMetricsResponse;
import com.workplace.help.dto.HelpOpenMetricRequest;
import com.workplace.help.dto.HelpSearchMissMetricRequest;
import com.workplace.help.service.HelpMetricService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** 도움말 지표 API(WP-1512) — 기록은 웹이 보내고 잊는(fire-and-forget) 호출로 로그인한 누구나, 조회는 audit:read. */
@RestController
@RequiredArgsConstructor
@RequestMapping("/api/v1/help/metrics")
public class HelpMetricController {

  private final HelpMetricService service;

  /** 도움말 열기를 기록한다. */
  @PostMapping("/open")
  public ResponseEntity<Void> open(@Valid @RequestBody HelpOpenMetricRequest req) {
    service.recordOpen(req.route(), req.helpId());
    return ResponseEntity.noContent().build();
  }

  /** 0건 검색을 기록한다. */
  @PostMapping("/search-miss")
  public ResponseEntity<Void> searchMiss(@Valid @RequestBody HelpSearchMissMetricRequest req) {
    service.recordSearchMiss(req.query(), req.route(), req.helpId());
    return ResponseEntity.noContent().build();
  }

  /**
   * 기간 안의 지표 상위 목록을 읽는다(관리자). days 는 7·30·90 만 허용하며 그 밖은 서비스가 400 으로 거절한다. 알 수 없는 kind 도 타입 변환 실패로
   * 400 이다.
   */
  @GetMapping
  @RequirePermission("audit:read")
  public ResponseEntity<HelpMetricsResponse> list(
      @RequestParam HelpMetricKind kind, @RequestParam(defaultValue = "7") int days) {
    return ResponseEntity.ok(new HelpMetricsResponse(kind, days, service.top(kind, days)));
  }
}
