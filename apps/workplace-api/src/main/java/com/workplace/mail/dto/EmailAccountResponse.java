package com.workplace.mail.dto;

import java.time.Instant;

/** 메일 계정 응답. 비밀번호 관련 필드는 일절 노출하지 않는다. */
public record EmailAccountResponse(
    long id,
    String emailAddress,
    String displayName,
    String imapHost,
    Integer imapPort, // M365 등 OAuth 계정은 null (IMAP 계정만 포트 존재)
    MailSecurity imapSecurity,
    String imapUsername,
    String smtpHost,
    Integer smtpPort, // M365 등 OAuth 계정은 null (IMAP 계정만 포트 존재)
    MailSecurity smtpSecurity,
    String smtpUsername,
    Instant lastTestedAt,
    Instant createdAt,
    Instant updatedAt,
    boolean aiEnabled,
    Instant lastSyncedAt,
    MailProvider provider) {} // provider: 메일 공급자(IMAP 기본값, M365_GRAPH 등)
