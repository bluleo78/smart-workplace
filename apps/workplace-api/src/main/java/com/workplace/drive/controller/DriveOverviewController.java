package com.workplace.drive.controller;

import com.workplace.drive.service.DriveOverviewService;
import org.springframework.http.MediaType;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

/** Drive 콘텐츠 검색 AI Overview SSE. 검색 상위 결과를 근거로 인용 답변 스트리밍. */
@RestController
@RequestMapping("/api/v1/drive")
public class DriveOverviewController {

  private final DriveOverviewService svc;

  public DriveOverviewController(DriveOverviewService svc) {
    this.svc = svc;
  }

  /**
   * GET /api/v1/drive/search-overview?q={query}&spaceId={spaceId} → SSE 스트림.
   *
   * <p>{@code event: delta {"text":"..."}} 토큰 스트리밍 후 {@code event: done {}} 로 종료한다. spaceId 미지정 시
   * 테넌트 전역, 지정 시 해당 공간 파일로 근거를 제한한다(콘텐츠 검색과 스코프 일관성 유지).
   */
  @GetMapping(value = "/search-overview", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
  public SseEmitter overview(
      @AuthenticationPrincipal Long callerId,
      @RequestParam String q,
      @RequestParam(required = false) Long spaceId) {
    return svc.streamOverview(callerId, q, spaceId);
  }
}
