package com.workplace.mail.dto;

import java.time.OffsetDateTime;
import java.util.List;

/**
 * 예약 보내기 목록 한 줄(WP-1787). {@link MailDraftSummary} 와 같은 필드에 보낼 시각을 더한다. 본문 HTML 은 싣지 않는다.
 *
 * @param preview 본문 텍스트 앞 120자(공백 정리)
 * @param attachmentCount 묶인 업로드 + 아직 남아 있는 전달 원본 첨부 수
 * @param sendAt 보낼 시각(예약한 시각 — 바로 보내기를 하면 그 시각으로 당겨진다)
 */
public record MailScheduledSummary(
    long id,
    long accountId,
    String mode,
    List<String> to,
    String subject,
    String preview,
    int attachmentCount,
    OffsetDateTime updatedAt,
    OffsetDateTime sendAt) {}
