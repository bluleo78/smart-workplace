package com.workplace.notify.dto;

import java.time.Instant;

/**
 * 알림 1건 응답. 표시용 필드는 읽을 때 조인 결과 — 이슈 계열은 issue·project·user, REMINDER 는 calendar_event 를 left join.
 * 프론트는 type 으로 분기: 이슈 계열은 issueKey={projectKey}-{issueNumber} 합성→이슈로 이동, REMINDER 는 eventTitle/
 * eventStartsAt 표시→/calendar 로 이동.
 *
 * @param actorId 행위자 id. 시스템 알림(REMINDER 등)이면 null
 * @param actorKind 'HUMAN' | 'AGENT' | null — AGENT 면 프론트가 AI 배지 표시
 * @param eventId REMINDER 대상 일정 id(이슈 알림이면 null)
 * @param eventTitle REMINDER 일정 제목(이슈 알림이면 null)
 * @param eventStartsAt REMINDER 일정 시작 시각(이슈 알림이면 null)
 * @param read read_at 존재 여부(읽음)
 */
public record NotificationResponse(
    Long id,
    String type,
    Long actorId,
    String actorName,
    String actorKind,
    Long issueId,
    String projectKey,
    Integer issueNumber,
    String issueTitle,
    Long commentId,
    Long eventId,
    String eventTitle,
    Instant eventStartsAt,
    boolean read,
    Instant createdAt) {}
