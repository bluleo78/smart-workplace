package com.workplace.calendar.dto;

/** 참석자 응답 DTO. */
public record AttendeeResponse(
    long userId,
    String username,
    String name,
    String kind,
    String role,
    String rsvpStatus,
    Long invitedByUserId) {}
