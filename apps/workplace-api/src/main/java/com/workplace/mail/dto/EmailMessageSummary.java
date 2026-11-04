package com.workplace.mail.dto;

import java.time.Instant;

/** 메일 목록 한 행(본문 제외, 미리보기 snippet 포함). */
public record EmailMessageSummary(
    long id,
    long accountId,
    String threadId,
    String fromAddress,
    String fromName,
    String subject,
    String snippet,
    Instant receivedAt,
    boolean seen,
    boolean hasAttachment,
    String aiCategory,
    Boolean aiNeedsReply, // 회신필요 = aiNeedsReply && !seen (WP-146 단일 술어)
    boolean categoryPending, // WP-186·WP-1347: 분류가 없음(시도 여부 무관) → "분류 전" 배지
    boolean categoryFailed, // WP-1347: 분류 재시도를 모두 소진한 최종 실패 → 배지 title 만 달라진다
    // WP-1325: 보낸 사람이 이 워크스페이스 구성원이 아님(외부 메일) — 목록 API 만 채운다. 판정할 수 없으면(주소 없음·다른 경로) null.
    Boolean externalSender) {

  /** 외부 메일 판정을 붙인 복사본(WP-1325) — 목록 조회 뒤 한 번의 일괄 조회로 채운다. */
  public EmailMessageSummary withExternalSender(Boolean external) {
    return new EmailMessageSummary(
        id,
        accountId,
        threadId,
        fromAddress,
        fromName,
        subject,
        snippet,
        receivedAt,
        seen,
        hasAttachment,
        aiCategory,
        aiNeedsReply,
        categoryPending,
        categoryFailed,
        external);
  }
}
