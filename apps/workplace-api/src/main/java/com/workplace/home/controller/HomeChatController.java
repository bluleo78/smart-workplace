package com.workplace.home.controller;

import com.workplace.home.dto.HomeChatActiveResponse;
import com.workplace.home.dto.HomeChatRequest;
import com.workplace.home.dto.HomeChatStartedResponse;
import com.workplace.home.exception.HomeAttachmentInvalidException;
import com.workplace.home.service.HomeAttachmentService;
import com.workplace.home.service.HomeChatService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
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
   * sessionId 미지정 시 새 세션 생성. 생성을 시작하고 {correlationId, sessionId} 를 즉시 반환한다 — 실제
   * delta/progress/tool/ pending_action/done/error/cancelled 는 통합 /events 채널(home.chat.*)로 전달된다. 같은
   * 대화 생성 중 409, 상한 429(WP-190). correlationId 는 웹이 정해 보낼 수 있고(WP-267), 진행 중인 생성과 겹치면 409.
   *
   * <p>enabled 확인·첨부 검증·비서 해석·USER 영속(+첨부 연결)은 요청 스레드에서 동기 수행 → 실패 시 4xx/5xx. ai-agent 호출은 비동기.
   */
  @PostMapping
  public HomeChatStartedResponse chat(
      @AuthenticationPrincipal Long callerId, @Valid @RequestBody HomeChatRequest request) {
    // WP-234: 본문도 첨부도 없으면 한국어 사유로 400(서비스도 같은 검사를 하지만 여기서 먼저 끊는다).
    if (!request.hasContent()) {
      throw new HomeAttachmentInvalidException(HomeAttachmentService.MSG_EMPTY);
    }
    return chatService.startChat(
        callerId,
        request.sessionId(),
        request.query(),
        request.screenContext(),
        request.fileIdsOrEmpty(),
        request.correlationId());
  }

  /** GET /api/v1/ai/chat/active — 호출자의 생성 중 대화와 상한(WP-190). 새로고침·SSE 재연결 뒤 웹이 상태를 복원한다. */
  @GetMapping("/active")
  public HomeChatActiveResponse active(@AuthenticationPrincipal Long callerId) {
    return chatService.active(callerId);
  }

  /** DELETE /api/v1/ai/chat/{correlationId} — 진행 중인 생성을 취소한다. */
  @DeleteMapping("/{correlationId}")
  public void cancel(@AuthenticationPrincipal Long callerId, @PathVariable String correlationId) {
    chatService.cancelChat(correlationId, callerId);
  }
}
