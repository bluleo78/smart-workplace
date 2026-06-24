package com.workplace.messaging.dto;

import java.util.List;

/**
 * 메시지에 붙은 쓰기 행동 제안(채팅 L3 위임). 이슈: title/priority/projectName/projectKey/candidates.
 * 일정(calendar.create_event): startsAt/endsAt/location/allDay/conflicts. status:
 * PENDING/CONFIRMED/REJECTED. CONFIRMED 면 resultIssueKey 채워짐(이슈=이슈키, 일정="event:{id}").
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
    List<ProjectCandidateDto> candidates,
    // --- 일정 전용 ---
    String startsAt,
    String endsAt,
    String location,
    Boolean allDay,
    List<EventConflictDto> conflicts) {}
