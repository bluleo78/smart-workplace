package com.workplace.mail.dto;

import java.time.Instant;
import java.util.List;

/**
 * 발송 파이프라인 내부 캐리어. MailSmtpSender(전송)·EmailMessageRepository.insertSent(로컬 저장)가 공유한다.
 * messageId/inReplyTo 는 꺾쇠 없는 정규화 id, references 는 꺾쇠 포함 원문(파서 저장 규칙과 일치).
 */
public record OutgoingMail(
    String messageId,
    String threadId,
    String fromAddress,
    String fromName,
    List<String> to,
    List<String> cc,
    List<String> bcc,
    String subject,
    String bodyText,
    String bodyHtml,
    String inReplyTo,
    String references,
    String snippet,
    Instant sentAt) {}
