package com.workplace.mail.dto;

import java.time.Instant;
import java.util.List;

/**
 * IMAP 메시지를 파싱한 내부 캐리어(헤더 + 본문 + 첨부 메타 + 스레드 그룹키). 동기화 단계에서 {@code MailMessageParser} 가 생성하고 {@code
 * EmailMessageRepository} 가 영속화한다. threadId 는 NOT NULL — 헤더가 전혀 없으면 합성 fallback("uid:{uid}").
 */
public record ParsedMessage(
    long imapUid,
    String messageId,
    String threadId,
    String inReplyTo,
    String references,
    String fromAddress,
    String fromName,
    String toAddresses,
    String ccAddresses,
    String subject,
    Instant sentAt,
    Instant receivedAt,
    boolean seen,
    boolean hasAttachment,
    String bodyText,
    String bodyHtml,
    String snippet,
    List<ParsedAttachment> attachments) {}
