package com.workplace.calendar.dto;

import jakarta.validation.constraints.Pattern;

/**
 * RSVP 요청 DTO. 사용자가 설정 가능한 상태는 ACCEPTED/DECLINED/TENTATIVE 세 가지. NEEDS_ACTION(초기값)은 사용자가 직접 설정
 * 불가.
 */
public record RsvpRequest(
    @Pattern(regexp = "ACCEPTED|DECLINED|TENTATIVE") String status) {}
