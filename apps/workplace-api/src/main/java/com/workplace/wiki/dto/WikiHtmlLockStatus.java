package com.workplace.wiki.dto;

import java.time.OffsetDateTime;

/**
 * 「HTML 문서」 편집 잠금 상태(WP-1308). 입력 없이 10분이 지난 잠금은 풀린 것으로 본다(locked=false).
 *
 * @param locked 누군가 살아 있는 잠금을 쥐고 있는지
 * @param mine 잠금이 요청자의 것인지 — 상태 조회는 사람으로(요청자가 쥠), 편집 중 신호 응답은 편집 세션으로(보낸 token 의 잠금) 가른다
 * @param holderId 잠금을 쥔 사람(없으면 null)
 * @param holderName 잠금을 쥔 사람 이름 — 위 띠 「○○ 님이 편집 중입니다」
 * @param acquiredAt 편집을 시작한 시각
 * @param expiresAt 지금처럼 입력이 없으면 자동으로 풀리는 시각(마지막 입력 + 10분)
 * @param canForceRelease 요청자가 남의 잠금을 강제로 풀 수 있는지(스페이스 소유자) — 「잠금 풀기」 단추
 */
public record WikiHtmlLockStatus(
    boolean locked,
    boolean mine,
    Long holderId,
    String holderName,
    OffsetDateTime acquiredAt,
    OffsetDateTime expiresAt,
    boolean canForceRelease) {

  /** 잠금 없음. */
  public static WikiHtmlLockStatus unlocked() {
    return new WikiHtmlLockStatus(false, false, null, null, null, null, false);
  }
}
