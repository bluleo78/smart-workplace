package com.workplace.auth.dto;

import java.time.Instant;

/**
 * 개인 비서 상태(없으면 configured=false). 토큰 평문/암호문 미포함. name 은 비서의 표시 이름(미설정이면 null). provider/baseUrl 은
 * 활성 자격증명의 프로바이더 메타(미설정/미등록이면 둘 다 null, anthropic 이면 baseUrl=null).
 */
public record AssistantStatusResponse(
    boolean configured,
    String tokenLabel,
    Instant tokenLastUsedAt,
    String model,
    String thinkingDepth,
    String name,
    String provider,
    String baseUrl) {}
