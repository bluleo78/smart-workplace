package com.workplace.calendar.dto;

/**
 * 참석자 응답 DTO.
 *
 * <p>내부 사용자: userId non-null, externalEmail null. 외부(우리 user 아님) 참석자: userId null, kind="EXTERNAL",
 * externalEmail non-null.
 */
public record AttendeeResponse(
    Long userId,
    String username,
    String name,
    String kind,
    String role,
    String rsvpStatus,
    Long invitedByUserId,
    String externalEmail) {}
