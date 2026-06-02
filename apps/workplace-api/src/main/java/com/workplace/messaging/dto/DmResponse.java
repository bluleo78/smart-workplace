package com.workplace.messaging.dto;

import java.time.Instant;
import java.util.List;

/**
 * DM 1건 요약. name 이 없는 DM 의 표시를 위해 참여자(본인 포함)를 동봉한다.
 *
 * @param participants 본인 포함 전원 — 프론트가 표시명 파생
 * @param lastMessageAt 최근 메시지 시각(메시지 0건이면 null)
 * @param unreadCount caller 미읽음 메시지 수(본인 작성·삭제 제외)
 */
public record DmResponse(
    Long id,
    List<DmParticipant> participants,
    Instant lastMessageAt,
    Instant createdAt,
    long unreadCount) {}
