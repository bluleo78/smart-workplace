package com.workplace.mail.dto;

import java.time.OffsetDateTime;

/**
 * 보내기 요청이 대기열에 올라간 결과(WP-1786). 메일은 아직 나가지 않았다 — sendAt 까지 되돌릴 수 있고, 그 뒤 스케줄러가 보낸다.
 *
 * @param draftId 대기 행이 된 임시보관 id(되돌리기 API 의 키)
 * @param sendAt 보내기로 정한 시각(지금 + 되돌리기 유예)
 */
public record QueuedSend(long draftId, OffsetDateTime sendAt) {}
