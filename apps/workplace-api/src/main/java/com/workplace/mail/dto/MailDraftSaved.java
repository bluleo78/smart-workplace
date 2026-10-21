package com.workplace.mail.dto;

import java.time.OffsetDateTime;

/** 임시저장 생성 결과(WP-577) — 이후 수정(PUT)에 id·version 을 쓴다. */
public record MailDraftSaved(long id, int version, OffsetDateTime updatedAt) {}
