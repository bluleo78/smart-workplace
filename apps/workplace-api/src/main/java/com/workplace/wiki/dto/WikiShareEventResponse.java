package com.workplace.wiki.dto;

import java.time.OffsetDateTime;

/**
 * 공유 기록 한 줄(WP-579) — 웹 {@code WikiShareEvent}. detail 은 서버가 만든 한 줄 요약이고 웹은 「{actor}님이 {detail}」로
 * 그대로 보인다.
 *
 * @param type CREATED | UPDATED | PEOPLE_ADDED | PEOPLE_REMOVED | REGENERATED | REVOKED | …
 * @param actor 한 사람(시스템이 한 일이면 {@link WikiSharePerson#SYSTEM})
 */
public record WikiShareEventResponse(
    long id, String type, WikiSharePerson actor, String detail, OffsetDateTime at) {}
