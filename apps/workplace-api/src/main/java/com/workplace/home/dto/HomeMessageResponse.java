package com.workplace.home.dto;

import com.fasterxml.jackson.databind.JsonNode;
import java.time.Instant;

/** 세션 메시지 1건(복원용). widgets/toolCalls 는 실제 JSON 으로 직렬화. */
public record HomeMessageResponse(
    long id,
    String role,
    String content,
    JsonNode widgets,
    /** AI 도구 호출/위임 단계(ASSISTANT 전용). null 가능. */
    JsonNode toolCalls,
    Instant createdAt) {}
