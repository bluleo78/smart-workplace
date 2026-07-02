package com.workplace.drive.controller;

import com.workplace.drive.service.DriveOverviewService;
import com.workplace.global.realtime.StreamingGenerationStartedResponse;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** Drive 콘텐츠 검색 AI Overview — 통합 /events 채널로 스트리밍(#593 편입). */
@RestController
@RequestMapping("/api/v1/drive")
public class DriveOverviewController {

  private final DriveOverviewService svc;

  public DriveOverviewController(DriveOverviewService svc) {
    this.svc = svc;
  }

  /**
   * GET /api/v1/drive/search-overview?q={query}&spaceId={spaceId} — 생성을 시작하고 correlationId 를 즉시
   * 반환한다. 실제 델타/완료/에러는 통합 /events 채널(drive.overview.*)로 전달된다.
   *
   * <p>spaceId 미지정 시 테넌트 전역, 지정 시 해당 공간 파일로 근거를 제한(콘텐츠 검색과 스코프 일관성 유지).
   */
  @GetMapping("/search-overview")
  public StreamingGenerationStartedResponse overview(
      @AuthenticationPrincipal Long callerId,
      @RequestParam String q,
      @RequestParam(required = false) Long spaceId) {
    return new StreamingGenerationStartedResponse(svc.startOverview(callerId, q, spaceId));
  }

  /** DELETE /api/v1/drive/search-overview/{correlationId} — 진행 중인 생성을 취소한다. */
  @DeleteMapping("/search-overview/{correlationId}")
  public void cancel(@AuthenticationPrincipal Long callerId, @PathVariable String correlationId) {
    svc.cancelOverview(correlationId, callerId);
  }
}
