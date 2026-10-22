package com.workplace.messaging.dto;

import com.workplace.global.time.SupportedDateTime;
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
 * startsAt·endsAt·allDay·location·reminderMinutes·recurrenceRule·conflicts·attendeeUserIds. title 은
 * 두 actionType 공용(필수). attendeeUserIds 는 ai-agent 가 username 을 해석한 초대 참석자 id(#852) — 서버가 테넌트 구성원인지
 * 다시 검증한다.
 */
public record CreateProposalRequest(
    // WP-726: 처리할 수 있는 두 종류만 — 임의 값(DELETE_ALL 등)이 이슈 생성 제안으로 저장·승인됐다.
    @NotBlank
        @Pattern(
            regexp = "CREATE_ISSUE|calendar\\.create_event",
            message = "제안 종류는 CREATE_ISSUE 또는 calendar.create_event 만 쓸 수 있습니다")
        String actionType,
    @NotBlank @Size(max = 200) String title,
    // --- 이슈 전용(CREATE_ISSUE) ---
    @Size(max = 10000) String body,
    @Pattern(regexp = "LOW|MID|HIGH") String priority,
    String projectKey,
    @NotNull Long proposedByUserId,
    Long parentMessageId,
    // --- 일정 전용(calendar.create_event) ---
    @SupportedDateTime OffsetDateTime startsAt,
    @SupportedDateTime OffsetDateTime endsAt,
    Boolean allDay,
    @Size(max = 200) String location,
    @Min(0) Integer reminderMinutes,
    @Size(max = 500) String recurrenceRule,
    List<EventConflictDto> conflicts,
    List<Long> attendeeUserIds) {}
