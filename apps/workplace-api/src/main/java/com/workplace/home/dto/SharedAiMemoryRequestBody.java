package com.workplace.home.dto;

import java.util.UUID;

/** 에이전트의 공용 메모리 직접 요청(스펙 6.2) — space 가 비거나 "current" 면 대화(sessionId)의 지금 공간, 아니면 공간 이름·프로젝트 키. */
public record SharedAiMemoryRequestBody(String content, String space, UUID sessionId) {}
