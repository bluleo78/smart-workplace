package com.workplace.calendar.dto;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;

/**
 * RSVP 요청 DTO. 사용자가 설정 가능한 상태는 ACCEPTED/DECLINED/TENTATIVE 세 가지. NEEDS_ACTION(초기값)은 사용자가 직접 설정 불가.
 *
 * <p>status 가 없으면 @Pattern 은 null 을 통과시켜 DB NOT NULL 위반(409)까지 내려갔다 — @NotNull 로 입력 오류 400 에서
 * 막는다(WP-542).
 */
public record RsvpRequest(
    @NotNull(message = RsvpRequest.STATUS_MESSAGE)
        @Pattern(regexp = "ACCEPTED|DECLINED|TENTATIVE", message = RsvpRequest.STATUS_MESSAGE)
        String status) {

  /** 상태 누락·잘못된 값 공통 안내(API·MCP 오류 문구). */
  static final String STATUS_MESSAGE = "참석 응답(ACCEPTED·DECLINED·TENTATIVE)을 골라 주세요";
}
