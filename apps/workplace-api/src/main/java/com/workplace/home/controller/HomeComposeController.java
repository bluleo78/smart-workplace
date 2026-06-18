package com.workplace.home.controller;

import com.workplace.home.dto.HomeComposeRequest;
import com.workplace.home.service.HomeComposeService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

/** 홈 컴포즈 SSE — 자연어 명령을 ai-agent 에 스트리밍 위임하고 delta/done/error 를 패스스루한다 (B2). */
@RestController
@RequiredArgsConstructor
@RequestMapping("/api/v1/home/compose")
public class HomeComposeController {

  private final HomeComposeService composeService;

  /**
   * sessionId 미지정 시 새 세션 생성. SSE 스트리밍 — delta/done/error 이벤트 패스스루.
   *
   * <p>enabled 확인·비서 해석·USER 영속은 요청 스레드에서 동기 수행 → 실패 시 스트림 전 4xx/5xx. ai-agent 호출은 비동기.
   */
  @PostMapping
  public SseEmitter compose(
      @AuthenticationPrincipal Long callerId, @Valid @RequestBody HomeComposeRequest request) {
    return composeService.composeStream(callerId, request.sessionId(), request.query());
  }
}
