package com.workplace.chat.controller;

import com.workplace.global.realtime.SseRegistry;
import lombok.RequiredArgsConstructor;
import org.springframework.http.MediaType;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

/**
 * chat 실시간 SSE 스트림. 유저당 글로벌 스트림 1개로 본인이 멤버인 모든 thread 이벤트를 수신한다.
 *
 * <p>프론트는 native EventSource 가 헤더를 못 싣으므로 fetch + ReadableStream 으로 Authorization 헤더를 실어 호출한다.
 */
@RestController
@RequiredArgsConstructor
@RequestMapping("/api/v1/chat")
public class ChatStreamController {

  private final SseRegistry registry;

  @GetMapping(value = "/stream", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
  public SseEmitter stream(@AuthenticationPrincipal Long callerId) {
    return registry.register(callerId);
  }
}
