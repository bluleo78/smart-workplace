package com.workplace.calendar.dto;

import java.time.Instant;
import java.time.OffsetDateTime;

/**
 * 일정 노트 연결의 키(WP-1701) — (일정 행 id, 회차의 원래 시작 시각). 반복 일정은 마스터 id + 그 회차의 원래 시작 시각, 반복이 아니거나 외부
 * 달력(M365) 회차 행은 그 행 id + null.
 *
 * <p>시각은 {@link Instant} 로 들고 비교한다 — 같은 순간을 {@code +09:00} 와 {@code Z} 로 달리 적어도 한 키가 되게(문자열 비교 금지).
 *
 * @param eventId 반복이면 마스터 id, 그 밖엔 그 일정 행 id
 * @param occurrenceStart 우리 반복 일정 회차의 원래 시작 시각. 반복 아님·M365 는 null
 */
public record NoteKey(long eventId, Instant occurrenceStart) {

  /** OffsetDateTime 으로 받은 회차 시각을 Instant 키로 바꾼다. occ 가 null 이면 회차 없는 키. */
  public static NoteKey of(long eventId, OffsetDateTime occ) {
    return new NoteKey(eventId, occ == null ? null : occ.toInstant());
  }
}
