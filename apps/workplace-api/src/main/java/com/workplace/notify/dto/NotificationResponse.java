package com.workplace.notify.dto;

import java.time.Instant;

/**
 * 알림 1건 응답. 표시용 필드(actorName/projectKey/issueNumber/issueTitle)는 읽을 때 issue·project·user 조인 결과.
 * 프론트는 issueKey 를 {projectKey}-{issueNumber} 로 합성하고 /projects/{projectKey}/issues/{issueNumber} 로
 * 이동한다.
 *
 * @param actorId 행위자 id. 시스템 알림이면 null
 * @param actorKind 'HUMAN' | 'AGENT' | null — AGENT 면 프론트가 AI 배지 표시
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
    boolean read,
    Instant createdAt) {}
