package com.workplace.chat.dto;

/** 메시지에서 멘션된 사용자. UserSummary 와 같은 shape 이지만 응답 계약 분리를 위해 별도 record. */
public record ChatMentionResponse(Long id, String username, String name, String kind) {}
