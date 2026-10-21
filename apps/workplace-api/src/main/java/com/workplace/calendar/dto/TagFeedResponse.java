package com.workplace.calendar.dto;

import java.time.OffsetDateTime;

/**
 * 태그 구독 주소(WP-715).
 *
 * @param url 로그인 없이 열리는 전체 주소({@code …/api/v1/public/calendar/feeds/{토큰}.ics}). 끝에 {@code
 *     ?week=2026-W43} 로 주를 고른다
 * @param createdAt 마지막 발급(재발급 포함) 시각
 * @param eventCount 지금 이 태그가 붙은 일정 수
 */
public record TagFeedResponse(String url, OffsetDateTime createdAt, int eventCount) {}
