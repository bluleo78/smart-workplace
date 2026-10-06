package com.workplace.home.dto;

import java.util.UUID;

/**
 * 홈 채팅 시작 응답(WP-190) — correlationId(이벤트 필터·취소 대상) + sessionId(새 대화면 서버가 만든 id). 웹은 sessionId 로 새
 * 대화의 임시 칸을 곧바로 실제 대화로 바꾼다. 필드 추가라 구 웹과 하위 호환.
 */
public record HomeChatStartedResponse(String correlationId, UUID sessionId) {}
