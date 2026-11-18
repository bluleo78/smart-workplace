package com.workplace.calendar.dto;

/**
 * 노트 잇기·조회 응답(WP-1701). note 가 null 이면(연결 없음) JSON 에 {@code "note": null} 로 싣는다 — 이 레코드에는 NON_NULL
 * 을 달지 않는다.
 */
public record EventNoteLinkResponse(EventNoteRef note) {}
