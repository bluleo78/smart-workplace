package com.workplace.mail.dto;

import java.time.Instant;

/** 메일 계정 응답. 비밀번호 관련 필드는 일절 노출하지 않는다. */
public record EmailAccountResponse(
    long id,
    String emailAddress,
    String displayName,
    String imapHost,
    int imapPort,
    MailSecurity imapSecurity,
    String imapUsername,
    String smtpHost,
    int smtpPort,
    MailSecurity smtpSecurity,
    String smtpUsername,
    Instant lastTestedAt,
    Instant createdAt,
    Instant updatedAt,
    boolean aiEnabled,
    Instant lastSyncedAt) {} // lastSyncedAt: 마지막 성공 동기화 시각(미동기화면 null)
