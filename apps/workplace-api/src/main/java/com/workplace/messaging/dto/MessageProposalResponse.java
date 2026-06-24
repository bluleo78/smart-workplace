package com.workplace.messaging.dto;

/**
 * 메시지에 붙은 쓰기 행동 제안(채팅 L3 위임). 카드 렌더용 요약 필드. title/priority/projectName 은 payload·조회에서 파생. status:
 * PENDING/CONFIRMED/REJECTED. CONFIRMED 면 resultIssueKey 채워짐.
 */
public record MessageProposalResponse(
    long id,
    long proposedByUserId,
    String actionType,
    String status,
    String title,
    String priority,
    String projectName,
    String resultIssueKey) {}
