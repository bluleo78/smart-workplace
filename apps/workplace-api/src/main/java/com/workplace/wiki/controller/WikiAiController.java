package com.workplace.wiki.controller;

import com.workplace.wiki.dto.WikiAiRequest;
import com.workplace.wiki.service.WikiAiService;
import jakarta.validation.Valid;
import org.springframework.http.MediaType;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

/** 인에디터 /ai 토큰 스트리밍 엔드포인트 (S3 B5). text/event-stream 으로 SseEmitter 를 반환한다. */
@RestController
@RequestMapping("/api/v1/wiki/pages")
public class WikiAiController {

  private final WikiAiService svc;

  public WikiAiController(WikiAiService svc) {
    this.svc = svc;
  }

  /** 페이지에 대해 /ai 컴포즈를 실행하고 SSE 로 토큰을 스트리밍한다. EDITOR 권한 필요. */
  @PostMapping(value = "/{pageId}/ai", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
  public SseEmitter ai(
      @AuthenticationPrincipal Long callerId,
      @PathVariable long pageId,
      @Valid @RequestBody WikiAiRequest req) {
    return svc.streamCompose(callerId, pageId, req);
  }
}
