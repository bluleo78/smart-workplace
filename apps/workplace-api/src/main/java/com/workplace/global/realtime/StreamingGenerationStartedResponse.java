package com.workplace.global.realtime;

/** 스트리밍 생성 시작 응답 — 발급된 correlationId 하나만 담는다. 클라이언트는 이 id 로 /events 이벤트를 필터링한다. */
public record StreamingGenerationStartedResponse(String correlationId) {}
