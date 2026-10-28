package com.workplace.mail.dto;

import java.time.Instant;
import java.util.List;

/**
 * 메일 본문 단건(헤더 + text/html 본문 + 첨부 메타).
 *
 * @param calendarInvite WP-986 일정 초대·취소 카드(초대 메일이 아니면 null)
 */
public record EmailMessageDetail(
    long id,
    String threadId,
    String messageId,
    String fromAddress,
    String fromName,
    String toAddresses,
    String ccAddresses,
    String bccAddresses,
    String subject,
    Instant sentAt,
    Instant receivedAt,
    boolean seen,
    String bodyText,
    String bodyHtml,
    List<EmailAttachmentMeta> attachments,
    CalendarInvite calendarInvite) {

  /** 초대 카드 없이 생성(저장소 조회 — 카드는 서비스가 내 캘린더 상태와 합쳐 붙인다). */
  public EmailMessageDetail(
      long id,
      String threadId,
      String messageId,
      String fromAddress,
      String fromName,
      String toAddresses,
      String ccAddresses,
      String bccAddresses,
      String subject,
      Instant sentAt,
      Instant receivedAt,
      boolean seen,
      String bodyText,
      String bodyHtml,
      List<EmailAttachmentMeta> attachments) {
    this(
        id,
        threadId,
        messageId,
        fromAddress,
        fromName,
        toAddresses,
        ccAddresses,
        bccAddresses,
        subject,
        sentAt,
        receivedAt,
        seen,
        bodyText,
        bodyHtml,
        attachments,
        null);
  }

  /** 초대 카드를 붙인 사본. */
  public EmailMessageDetail withCalendarInvite(CalendarInvite invite) {
    return new EmailMessageDetail(
        id,
        threadId,
        messageId,
        fromAddress,
        fromName,
        toAddresses,
        ccAddresses,
        bccAddresses,
        subject,
        sentAt,
        receivedAt,
        seen,
        bodyText,
        bodyHtml,
        attachments,
        invite);
  }
}
