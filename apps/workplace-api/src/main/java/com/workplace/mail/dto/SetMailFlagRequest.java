package com.workplace.mail.dto;

import jakarta.validation.constraints.NotNull;

/**
 * 메일 별표 켜기/끄기 요청(WP-1741, {@code PUT /api/v1/mail/messages/{id}/flag}).
 *
 * @param flagged true 면 별표, false 면 해제. 누락은 400 — 기본값으로 별표를 지우는 실수를 막는다
 */
public record SetMailFlagRequest(@NotNull Boolean flagged) {}
