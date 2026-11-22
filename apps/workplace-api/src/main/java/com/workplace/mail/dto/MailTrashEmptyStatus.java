package com.workplace.mail.dto;

import java.time.Instant;

/**
 * 휴지통 비우기 작업 상태(WP-1682) — {@code POST}·{@code GET /accounts/{accountId}/trash/empty} 응답. 웹이
 * RUNNING 동안 폴링해 진행·실패 수를 보이고, 끝나면 토스트를 띄운다.
 *
 * @param state {@code IDLE}(시작 전·재시작으로 사라짐) · {@code RUNNING} · {@code DONE}(끝까지 돌았다, failed 가 있을 수
 *     있음) · {@code FAILED}(중간에 멈췄다)
 * @param total 시작 때 서버 휴지통 메일 수(스냅샷 전이면 null)
 * @param deleted 서버에서 지웠거나 이미 없던 메일 수
 * @param failed 지우지 못한 메일 수(FAILED 면 남은 메일까지 더해 {@code deleted + failed = total})
 * @param startedAt 시작 시각(IDLE 이면 null)
 * @param finishedAt 끝난 시각(RUNNING·IDLE 이면 null)
 * @param errorCode FAILED 사유 코드({@code MailTrashException} 코드)
 * @param error FAILED 사유 화면 문구
 */
public record MailTrashEmptyStatus(
    String state,
    Integer total,
    int deleted,
    int failed,
    Instant startedAt,
    Instant finishedAt,
    String errorCode,
    String error) {

  /** 시작 전 상태(작업 기록이 없다). */
  public static final MailTrashEmptyStatus IDLE =
      new MailTrashEmptyStatus("IDLE", null, 0, 0, null, null, null, null);
}
