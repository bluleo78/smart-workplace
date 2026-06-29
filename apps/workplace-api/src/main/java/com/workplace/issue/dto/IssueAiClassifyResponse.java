package com.workplace.issue.dto;

import java.util.List;

/** 이슈 AI 분류 제안 응답 — 프론트엔드 폼에 채워 넣는 용도. DB 저장 없음(Migration-0). */
public record IssueAiClassifyResponse(
    /** 제안 유형(TASK/BUG/STORY/CHORE). 개인 프로젝트면 null. */
    String type,
    /** 제안 우선순위(LOW/MID/HIGH). 항상 반환. */
    String priority,
    /** 제안 라벨 이름 목록 — 프로젝트 실제 라벨 교차검증 완료. */
    List<String> labels,
    /** 분류 이유 한 문장. */
    String reason) {}
