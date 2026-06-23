package com.workplace.messaging.controller;

import com.workplace.messaging.dto.MessagingSummaryResponse;
import com.workplace.messaging.service.MessagingSummaryService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 홈 대시보드 대화 요약 REST — 본인 최근 대화 N건 + 회신대기/안읽음 카운트.
 *
 * <p>MeMailSummaryController 미러: @AuthenticationPrincipal 본인 스코프, 별도 권한 없이 본인 소유만. 읽기 전용.
 *
 * <p>집계는 {@link MessagingSummaryService#summary} 에 위임 — 트랜잭션 경계 안에서 읽어야 RLS GUC(app.tenant_id)가
 * 주입되어 안읽음 수가 0으로 비는 버그(#444)를 막는다.
 */
@RestController
@RequiredArgsConstructor
@RequestMapping("/api/v1/me/messaging-summary")
public class MeMessagingSummaryController {

  /** 홈 위젯이 한 번에 소비 — 최근 대화 최대 5건. */
  private static final int RECENT_LIMIT = 5;

  private final MessagingSummaryService messagingSummaryService;

  /** 안읽음 수 + 회신대기 수 + 최근 대화 N건을 묶어 반환. */
  @GetMapping
  public ResponseEntity<MessagingSummaryResponse> summary(@AuthenticationPrincipal Long callerId) {
    return ResponseEntity.ok(messagingSummaryService.summary(callerId, RECENT_LIMIT));
  }
}
