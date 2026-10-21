package com.workplace.calendar.dto;

/**
 * 일정의 온라인 회의 참가 정보(WP-710).
 *
 * @param provider 공급자 — TEAMS | MEET | ZOOM | OTHER (주소로 알아볼 수 없는 회의는 OTHER)
 * @param joinUrl 참가 주소 — 항상 http(s)
 */
public record OnlineMeeting(String provider, String joinUrl) {}
