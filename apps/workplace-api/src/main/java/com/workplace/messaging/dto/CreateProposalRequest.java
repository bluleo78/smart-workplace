package com.workplace.messaging.dto;

import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.time.OffsetDateTime;
import java.util.List;

/**
 * AI 가 채널에 올리는 쓰기 행동 제안 요청(내부 on-behalf). actionType: "CREATE_ISSUE" 또는 "calendar.create_event".
 * proposedByUserId = 위임자(트리거 actor) — 승인 권한자. parentMessageId = 스레드 미러(인라인이면 null).
 *
 * <p>이슈 전용: body·priority·projectKey. 일정 전용:
 * startsAt·endsAt·allDay·location·reminderMinutes·recurrenceRule·conflicts. title 은 두 actionType
 * 공용(필수).
 */
public record CreateProposalRequest(
    @NotBlank String actionType,
    @NotBlank @Size(max = 200) String title,
    // --- 이슈 전용(CREATE_ISSUE) ---
    @Size(max = 10000) String body,
    @Pattern(regexp = "LOW|MID|HIGH") String priority,
    String projectKey,
    @NotNull Long proposedByUserId,
    Long parentMessageId,
    // --- 일정 전용(calendar.create_event) ---
    OffsetDateTime startsAt,
    OffsetDateTime endsAt,
    Boolean allDay,
    @Size(max = 200) String location,
    @Min(0) Integer reminderMinutes,
    @Size(max = 500) String recurrenceRule,
    List<EventConflictDto> conflicts) {}
