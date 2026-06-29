package com.workplace.issue.outbound.dto;

import java.util.List;

/** ai-agent POST /issue/classify 요청 DTO. */
public record IssueClassifyRequest(
    String title,
    String body,
    /** 프로젝트 실제 라벨 이름 목록 — ai-agent 가 allowlist 로 활용. */
    List<String> projectLabels,
    /** 개인 프로젝트이면 type 제안 생략 지시. */
    boolean isPersonalProject,
    long assistantAgentId,
    String model,
    int maxTurns,
    long timeoutMs) {}
