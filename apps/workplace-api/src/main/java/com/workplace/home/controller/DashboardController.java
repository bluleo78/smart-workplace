package com.workplace.home.controller;

import com.workplace.home.dto.DashboardResponse;
import com.workplace.home.dto.DashboardUpdateRequest;
import com.workplace.home.service.DashboardService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** 홈 대시보드 레이아웃 REST. 모든 엔드포인트는 본인(callerId) 스코프 — 위젯 레이아웃은 계정당 1행이며 tenant RLS 로 격리된다. */
@RestController
@RequiredArgsConstructor
@RequestMapping("/api/v1/me/dashboard")
public class DashboardController {

  private final DashboardService service;

  /** 내 대시보드 레이아웃. 미설정이면 기본 레이아웃. */
  @GetMapping
  public ResponseEntity<DashboardResponse> get(@AuthenticationPrincipal Long callerId) {
    return ResponseEntity.ok(service.get(callerId));
  }

  /** 내 대시보드 레이아웃 저장(전체 교체). 알 수 없는/중복 위젯은 제거, 비면 400. */
  @PutMapping
  public ResponseEntity<DashboardResponse> put(
      @AuthenticationPrincipal Long callerId, @Valid @RequestBody DashboardUpdateRequest req) {
    return ResponseEntity.ok(service.save(callerId, req.widgets()));
  }
}
