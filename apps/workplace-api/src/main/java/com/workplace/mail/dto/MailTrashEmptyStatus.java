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

  // ===== 진행 반영용 사본 — MailTrashEmptyProgress 가 바꿀 때마다 쓴다. 필드 목록을 여기 한 곳에만 둔다(인자가 있어 JSON 속성이 아니다).
  // =====

  /** 시작 때 센 서버 휴지통 메일 수를 적은 사본. */
  public MailTrashEmptyStatus withTotal(int total) {
    return new MailTrashEmptyStatus(state, total, deleted, failed, startedAt, null, null, null);
  }

  /** 지운(또는 이미 없던) 메일 수를 더한 사본. */
  public MailTrashEmptyStatus plusDeleted(int n) {
    return new MailTrashEmptyStatus(state, total, deleted + n, failed, startedAt, null, null, null);
  }

  /** 지우지 못한 메일 수를 더한 사본. */
  public MailTrashEmptyStatus plusFailed(int n) {
    return new MailTrashEmptyStatus(state, total, deleted, failed + n, startedAt, null, null, null);
  }

  /** 끝까지 돌았다 — DONE + 끝난 시각(failed 는 그대로). */
  public MailTrashEmptyStatus done(Instant at) {
    return new MailTrashEmptyStatus("DONE", total, deleted, failed, startedAt, at, null, null);
  }

  /**
   * 중간에 멈췄다 — FAILED + 끝난 시각 + 사유. total 을 알면 아직 처리하지 않은 메일을 실패로 더해 {@code deleted + failed =
   * total} 을 맞춘다(웹이 「n통은 지우지 못했습니다」를 바로 보일 수 있게).
   */
  public MailTrashEmptyStatus stopped(Instant at, String code, String message) {
    int allFailed = total == null ? failed : failed + Math.max(0, total - deleted - failed);
    return new MailTrashEmptyStatus(
        "FAILED", total, deleted, allFailed, startedAt, at, code, message);
  }
}
