package com.workplace.global.ai;

import com.fasterxml.jackson.annotation.JsonInclude;

/**
 * ai-agent 로 보내는 메모리 한 줄 — 홈 채팅(ChatRequest.memories, WP-55)과 다른 진입점(노트·메일·드라이브·채널 따라잡기, WP-381)이
 * 같은 정의를 쓴다. ai-agent memoryItemSchema(id·kind·content·scope?·expiresOn?)와 같은 모양이고, 블록의 "#id" 가 메모리
 * 도구의 memoryId 다. scope(WP-379)는 앱 범위일 때만, expiresOn(WP-380)은 기한이 있을 때만 싣는다(null → JSON 에서 빠져 구
 * ai-agent 와 같은 모양). expiresOn 은 yyyy-MM-dd 문자열이다 — ai-agent 클라이언트들이 java.time 모듈 없는 ObjectMapper 로
 * 직렬화한다.
 */
public record AiMemoryLine(
    long id,
    String kind,
    String content,
    @JsonInclude(JsonInclude.Include.NON_NULL) String scope,
    @JsonInclude(JsonInclude.Include.NON_NULL) String expiresOn) {}
