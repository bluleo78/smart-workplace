package com.workplace.home.controller;

import com.workplace.global.realtime.StreamingGenerationStartedResponse;
import com.workplace.home.dto.HomeChatRequest;
import com.workplace.home.service.HomeChatService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** 홈 채팅 — 통합 /events 채널로 스트리밍(#593 편입, B2). */
@RestController
@RequiredArgsConstructor
@RequestMapping("/api/v1/ai/chat")
public class HomeChatController {

  private final HomeChatService chatService;

  /**
   * sessionId 미지정 시 새 세션 생성. 생성을 시작하고 correlationId 를 즉시 반환한다 — 실제 delta/progress/tool/
   * pending_action/done/error 는 통합 /events 채널(home.chat.*)로 전달된다.
   *
   * <p>enabled 확인·비서 해석·USER 영속은 요청 스레드에서 동기 수행 → 실패 시 4xx/5xx. ai-agent 호출은 비동기.
   */
  @PostMapping
  public StreamingGenerationStartedResponse chat(
      @AuthenticationPrincipal Long callerId, @Valid @RequestBody HomeChatRequest request) {
    return new StreamingGenerationStartedResponse(
        chatService.startChat(callerId, request.sessionId(), request.query()));
  }

  /** DELETE /api/v1/ai/chat/{correlationId} — 진행 중인 생성을 취소한다. */
  @DeleteMapping("/{correlationId}")
  public void cancel(@AuthenticationPrincipal Long callerId, @PathVariable String correlationId) {
    chatService.cancelChat(correlationId, callerId);
  }
}
