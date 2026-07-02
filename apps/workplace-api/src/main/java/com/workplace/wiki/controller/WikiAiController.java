package com.workplace.wiki.controller;

import com.workplace.global.realtime.StreamingGenerationStartedResponse;
import com.workplace.wiki.dto.WikiAiRequest;
import com.workplace.wiki.service.WikiAiService;
import jakarta.validation.Valid;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** 인에디터 /ai 생성 시작·취소 엔드포인트(#593 편입 — 이전 전용 SseEmitter 대신 통합 /api/v1/events 로 토큰이 전달된다). */
@RestController
@RequestMapping("/api/v1/wiki/pages")
public class WikiAiController {

  private final WikiAiService svc;

  public WikiAiController(WikiAiService svc) {
    this.svc = svc;
  }

  /** 생성을 시작하고 correlationId 를 즉시 반환한다. 실제 토큰은 wiki.ai.delta/done/error 이벤트로 /events 에 전달된다. */
  @PostMapping("/{pageId}/ai")
  public StreamingGenerationStartedResponse ai(
      @AuthenticationPrincipal Long callerId,
      @PathVariable long pageId,
      @Valid @RequestBody WikiAiRequest req) {
    return new StreamingGenerationStartedResponse(svc.startCompose(callerId, pageId, req));
  }

  /** 진행 중인 생성을 취소한다. */
  @DeleteMapping("/{pageId}/ai/{correlationId}")
  public void cancel(
      @AuthenticationPrincipal Long callerId,
      @PathVariable long pageId,
      @PathVariable String correlationId) {
    svc.cancelCompose(correlationId, callerId);
  }
}
