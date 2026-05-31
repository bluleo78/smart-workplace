package com.workplace.auth.dto;

/** 공용 비서 상태. 미지정이면 agentUserId=null. */
public record WorkspaceAssistantResponse(
    Long agentUserId,
    String agentName,
    boolean hasActiveToken,
    String model,
    String thinkingDepth) {}
