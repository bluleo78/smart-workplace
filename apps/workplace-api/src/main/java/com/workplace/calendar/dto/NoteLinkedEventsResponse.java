package com.workplace.calendar.dto;

import java.util.List;

/** 노트에 이어진 일정 목록 응답(WP-1703) — 일시 내림차순(최근 일정 먼저), 최대 50개. 없으면 빈 목록. */
public record NoteLinkedEventsResponse(List<NoteLinkedEventResponse> items) {}
