package com.workplace.mail.dto;

import java.time.Instant;
import java.util.List;

/** 메일 본문 단건(헤더 + text/html 본문 + 첨부 메타). */
public record EmailMessageDetail(
    long id,
    String threadId,
    String messageId,
    String fromAddress,
    String fromName,
    String toAddresses,
    String ccAddresses,
    String subject,
    Instant sentAt,
    Instant receivedAt,
    boolean seen,
    String bodyText,
    String bodyHtml,
    List<EmailAttachmentMeta> attachments) {}
