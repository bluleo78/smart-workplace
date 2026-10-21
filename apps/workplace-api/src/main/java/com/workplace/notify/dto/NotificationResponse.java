package com.workplace.notify.dto;

import java.time.Instant;

/**
 * 알림 1건 응답. 표시용 필드는 읽을 때 조인 결과 — 이슈 계열은 issue·project·user, REMINDER 는 calendar_event 를 left join.
 * 프론트는 type 으로 분기: 노트 공유 계열은 wikiPageTitle·message 로 문구를 만들고 /wiki/open/{wikiPageId} 로 이동, 이슈 계열은
 * issueKey={projectKey}-{issueNumber} 합성→이슈로 이동, REMINDER 는 eventTitle/ eventStartsAt 표시→/calendar
 * 로 이동.
 *
 * @param actorId 행위자 id. 시스템 알림(REMINDER 등)이면 null
 * @param actorKind 'HUMAN' | 'AGENT' | null — AGENT 면 프론트가 AI 배지 표시
 * @param eventId REMINDER 대상 일정 id(이슈 알림이면 null)
 * @param eventTitle REMINDER 일정 제목(이슈 알림이면 null)
 * @param eventStartsAt REMINDER 일정 시작 시각(이슈 알림이면 null)
 * @param wikiPageId 노트 공유 알림(WIKI_*)이 가리키는 노트 id(그 외에는 null)
 * @param wikiPageTitle 노트 공유 알림의 노트 제목(그 외에는 null)
 * @param message 공유한 사람이 덧붙인 메시지(WIKI_SHARED 만, 없으면 null)
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
    Long wikiPageId,
    String wikiPageTitle,
    String message,
    boolean read,
    Instant createdAt) {}
