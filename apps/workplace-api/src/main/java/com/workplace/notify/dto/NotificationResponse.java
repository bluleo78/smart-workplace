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
 * @param statusName STATUS_CHANGED 알림의 새 상태 이름(WP-869). 이름을 남기기 전 알림·그 외 유형은 null — 프론트는 없으면 기존 문구
 * @param agentWorkState AI 작업 상태로 생긴 알림의 원인 상태(WP-913) — AI_REVIEW_REQUESTED=REVIEW,
 *     AI_WORK_FAILED=FAILED|REJECTED, 상태 경로 AI_QUESTION=AUTH_REQUIRED|BLOCKED|INPUT_REQUIRED. 이슈 챗
 *     질문으로 생긴 AI_QUESTION·그 외 유형은 null — 프론트가 상태별 문구를 고른다
 * @param mailDraftId 메일 발송 실패 알림(MAIL_SEND_FAILED, WP-1786)이 가리키는 임시보관 id — 누르면 그 임시보관을 쓰기 창으로 연다(그
 *     외 유형은 null). 임시보관은 그 뒤 지워질 수 있어 가리키는 행이 없을 수 있다
 * @param mailSendUnknown 메일 발송 실패 알림의 변형 — true 면 발송 중 멈춰 결과를 모르는 「보냈는지 확인하지 못함 — 보낸편지함을 확인해 주세요」,
 *     false 면 「메일을 보내지 못함」. 다른 유형은 늘 false
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
    String statusName,
    String agentWorkState,
    Long mailDraftId,
    boolean mailSendUnknown,
    boolean read,
    Instant createdAt) {}
