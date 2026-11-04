package com.workplace.mail.dto;

import java.time.Instant;
import java.util.List;

/**
 * 메일 본문 단건(헤더 + text/html 본문 + 첨부 메타).
 *
 * @param calendarInvite WP-986 일정 초대·취소 카드(초대 메일이 아니면 null)
 * @param aiCategory WP-1341 유효 분류(직접 바꾼 분류 &gt; 개인 비서 분류 &gt; 검증된 공용 분류, 없으면 null)
 * @param categoryByMe WP-1341 사용자가 직접 바꾼 분류인지(분류 메뉴의 「AI 분류로 되돌리기」 표시)
 * @param sentByGeniaWorks WP-1364 받은 원본의 X-Mailer 가 Gen:iA Works 인지(본문 검증 전 사본은 false)
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
    CalendarInvite calendarInvite,
    String aiCategory,
    boolean categoryByMe,
    boolean sentByGeniaWorks) {

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
        invite,
        aiCategory,
        categoryByMe,
        sentByGeniaWorks);
  }

  /** 읽음 상태만 바꾼 사본(열람 시 읽음 처리 — 분류·초대 카드는 그대로). */
  public EmailMessageDetail withSeen(boolean seen) {
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
        calendarInvite,
        aiCategory,
        categoryByMe,
        sentByGeniaWorks);
  }

  /** 첨부 목록만 바꾼 사본(저장소가 첨부 메타를 따로 읽어 붙인다 — 다른 필드는 그대로). */
  public EmailMessageDetail withAttachments(List<EmailAttachmentMeta> attachments) {
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
        calendarInvite,
        aiCategory,
        categoryByMe,
        sentByGeniaWorks);
  }
}
