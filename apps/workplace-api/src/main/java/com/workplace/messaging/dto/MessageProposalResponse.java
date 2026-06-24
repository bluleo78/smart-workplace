package com.workplace.messaging.dto;

import java.util.List;

/**
 * 메시지에 붙은 쓰기 행동 제안(채팅 L3 위임). 카드 렌더용 요약 필드. title/priority/projectName 은 payload·조회에서 파생. status:
 * PENDING/CONFIRMED/REJECTED. CONFIRMED 면 resultIssueKey 채워짐. projectKey/candidates 는 L3 후보
 * 라우팅(Task 2) — candidates 는 AI 가 고를 수 있었던 전체 후보 목록, projectKey 는 AI 가 선택한 키(폴백=개인기본).
 */
public record MessageProposalResponse(
    long id,
    long proposedByUserId,
    String actionType,
    String status,
    String title,
    String priority,
    String projectName,
    String resultIssueKey,
    String projectKey,
    List<ProjectCandidateDto> candidates) {}
