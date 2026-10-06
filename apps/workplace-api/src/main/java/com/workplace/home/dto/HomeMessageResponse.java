package com.workplace.home.dto;

import com.fasterxml.jackson.databind.JsonNode;
import java.time.Instant;
import java.util.List;

/** 세션 메시지 1건(복원용). widgets/toolCalls 는 실제 JSON 으로 직렬화. */
public record HomeMessageResponse(
    long id,
    String role,
    String content,
    JsonNode widgets,
    /** AI 도구 호출/위임 단계(ASSISTANT 전용). null 가능. */
    JsonNode toolCalls,
    /** 표시 블록 순서(텍스트·도구 그룹·위젯, ASSISTANT 전용 — WP-158). null 이면 웹 폴백 렌더. */
    JsonNode contentBlocks,
    Instant createdAt,
    /** 이 메시지에 붙은 첨부(WP-234, USER 전용). 없으면 빈 배열 — 새로고침 후 말풍선 복원. */
    List<HomeAttachment> attachments) {}
