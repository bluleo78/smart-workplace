package com.workplace.messaging.controller;

import com.workplace.global.security.InternalOnBehalfOf;
import com.workplace.messaging.dto.MessagingAgentRunAcquireRequest;
import com.workplace.messaging.dto.MessagingAgentRunAcquireResponse;
import com.workplace.messaging.dto.MessagingAgentRunReleaseRequest;
import com.workplace.messaging.dto.MessagingAgentRunReleaseResponse;
import com.workplace.messaging.service.MessagingAgentRunService;
import lombok.RequiredArgsConstructor;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

/**
 * 메시징 AI 대화별 실행 임대(WP-1979) — ai-agent 전용 내부 엔드포인트. Internal 토큰 + X-On-Behalf-Of(응답 AI id) 인증만
 * 받는다(그 밖은 403).
 */
@RestController
@RequiredArgsConstructor
public class MessagingAgentRunInternalController {

  private final MessagingAgentRunService service;

  /** 대화 실행 임대를 얻는다 — ACQUIRED·QUEUED·DUPLICATE. */
  @PostMapping("/api/v1/internal/messaging/agent-runs/acquire")
  public MessagingAgentRunAcquireResponse acquire(
      Authentication auth, @RequestBody MessagingAgentRunAcquireRequest body) {
    InternalOnBehalfOf.requireInternal(auth, "내부 호출만 메시징 AI 실행 임대를 얻을 수 있습니다");
    requireSameAgent(auth, body.agentId());
    return service.acquire(body);
  }

  /** 임대를 반납하고, 기다리던 이벤트가 있으면 돌려준다. */
  @PostMapping("/api/v1/internal/messaging/agent-runs/release")
  public MessagingAgentRunReleaseResponse release(
      Authentication auth, @RequestBody MessagingAgentRunReleaseRequest body) {
    InternalOnBehalfOf.requireInternal(auth, "내부 호출만 메시징 AI 실행 임대를 반납할 수 있습니다");
    requireSameAgent(auth, body.agentId());
    return service.release(body);
  }

  /** 본문 agentId 가 X-On-Behalf-Of 주체와 다르면 403 — 한 AI 신원이 다른 AI 의 임대를 잡거나 풀지 못하게 한다. */
  private static void requireSameAgent(Authentication auth, long agentId) {
    if (!Long.valueOf(agentId).equals(auth.getPrincipal())) {
      throw new AccessDeniedException("본문 agentId 가 대행 AI 와 다릅니다");
    }
  }
}
