package com.workplace.messaging.controller;

import com.workplace.global.realtime.SseRegistry;
import lombok.RequiredArgsConstructor;
import org.springframework.http.MediaType;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

/**
 * messaging 실시간 SSE 스트림. 유저당 스트림 1개로 본인이 멤버인 모든 채널 이벤트를 수신한다. 프론트는 fetch + ReadableStream 으로
 * Authorization 헤더를 실어 호출한다(native EventSource 헤더 미지원).
 */
@RestController
@RequiredArgsConstructor
@RequestMapping("/api/v1/messaging")
public class MessageStreamController {

  private final SseRegistry registry;

  @GetMapping(value = "/stream", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
  public SseEmitter stream(@AuthenticationPrincipal Long callerId) {
    return registry.register(callerId);
  }
}
