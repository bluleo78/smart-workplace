package com.workplace.messaging.dto;

import tools.jackson.databind.JsonNode;

/**
 * 메시징 AI 대화별 실행 임대 획득 요청(WP-1979). 키는 (channelId, parentMessageId, agentId) — 스레드가 없는 인라인 멘션은
 * parentMessageId 를 null 로 보내고 서버가 0 으로 바꾼다. event 는 실행이 바쁠 때 대기시킬 이벤트 본문이며 그대로 돌려준다(필수 — 없거나 JSON
 * null 이면 400). token 은 ai-agent 가 미리 만든 소유 토큰(UUID 문자열, 선택) — 응답을 잃어도 ai-agent 가 그 토큰으로 반납할 수 있게
 * 한다. 구버전 ai-agent 는 보내지 않으며 그때는 서버가 만든다.
 */
public record MessagingAgentRunAcquireRequest(
    long channelId,
    Long parentMessageId,
    long agentId,
    long messageId,
    long leaseMs,
    JsonNode event,
    String token) {}
