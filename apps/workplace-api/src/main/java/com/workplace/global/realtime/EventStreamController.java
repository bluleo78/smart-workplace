package com.workplace.global.realtime;

import lombok.RequiredArgsConstructor;
import org.springframework.http.MediaType;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

/**
 * 실시간 통합 SSE 스트림. chat·messaging·notify 이벤트를 유저당 단일 커넥션으로 수신한다.
 *
 * <p>{@link SseRegistry}가 userId 키 하나로 도메인 중립 관리하므로, 이 엔드포인트 하나면 본인이 멤버인 모든 thread·channel 이벤트와 알림이
 * event 이름(chat.x/messaging.x/notify.x) prefix 로 태깅돼 들어온다. 프론트는 단일 구독 후 이름 prefix 로 fan-out 한다.
 *
 * <p>native EventSource 는 커스텀 헤더 미지원 → 프론트는 fetch + ReadableStream 으로 Authorization 헤더를 싣는다.
 */
@RestController
@RequiredArgsConstructor
@RequestMapping("/api/v1")
public class EventStreamController {

  private final SseRegistry registry;

  @GetMapping(value = "/events", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
  public SseEmitter stream(@AuthenticationPrincipal Long callerId) {
    return registry.register(callerId);
  }
}
