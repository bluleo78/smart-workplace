package com.workplace.messaging.dto;

import java.time.Instant;
import java.util.List;

/**
 * DM 1건 요약. name 이 없는 DM 의 표시를 위해 참여자(본인 포함)를 동봉한다.
 *
 * @param participants 본인 포함 전원 — 프론트가 표시명 파생
 * @param lastMessageAt 최근 메시지 시각(메시지 0건이면 null)
 * @param unreadCount caller 미읽음 메시지 수(본인 작성·삭제 제외)
 * @param lastMessage 마지막 최상위 메시지 요약(목록 미리보기). 목록에서만 채움, 그 외 null
 */
public record DmResponse(
    Long id,
    List<DmParticipant> participants,
    Instant lastMessageAt,
    Instant createdAt,
    long unreadCount,
    LastMessageSummary lastMessage) {

  /** lastMessage 없이 생성 — 단건 상세·생성 응답은 미리보기를 싣지 않는다. */
  public DmResponse(
      Long id,
      List<DmParticipant> participants,
      Instant lastMessageAt,
      Instant createdAt,
      long unreadCount) {
    this(id, participants, lastMessageAt, createdAt, unreadCount, null);
  }

  /** 미리보기만 바꾼 사본. */
  public DmResponse withLastMessage(LastMessageSummary lm) {
    return new DmResponse(id, participants, lastMessageAt, createdAt, unreadCount, lm);
  }
}
