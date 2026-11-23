package com.workplace.mail.dto;

import java.time.Instant;
import java.util.List;

/**
 * IMAP 메시지를 파싱한 내부 캐리어(헤더 + 본문 + 첨부 메타 + 스레드 그룹키). 동기화 단계에서 {@code MailMessageParser} 가 생성하고 {@code
 * EmailMessageRepository} 가 영속화한다. threadId 는 NOT NULL — 헤더가 전혀 없으면 합성 fallback("uid:{uid}").
 *
 * <p>structure: IMAP BODYSTRUCTURE 요약(WP-130 content 공유 지문 재료). 본문 다운로드 없이 동기화 시점에 계산한다. null 이면
 * IMAP 경로에서 공유하지 않는다(fail-closed). Graph·보낸메일 경로는 사용하지 않는다.
 *
 * <p>flagged: 서버 별표(IMAP \Flagged, Graph flag.flagStatus=flagged — WP-1741). 새 envelope 삽입 때만 쓰고,
 * 기존 행 갱신은 동기화 경로가 따로 한다.
 *
 * <p>confidential: 발신 측이 Sensitivity 헤더로 기밀 표시한 받은 메일(WP-2030). 목록 동기화 때 헤더만으로 판정해 저장한다.
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
    List<ParsedAttachment> attachments,
    String structure,
    boolean flagged,
    boolean confidential) {

  /** 기밀 표시 없이 생성(기존 호출부 호환) — confidential=false. */
  public ParsedMessage(
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
      List<ParsedAttachment> attachments,
      String structure,
      boolean flagged) {
    this(
        imapUid,
        messageId,
        threadId,
        inReplyTo,
        references,
        fromAddress,
        fromName,
        toAddresses,
        ccAddresses,
        subject,
        sentAt,
        receivedAt,
        seen,
        hasAttachment,
        bodyText,
        bodyHtml,
        snippet,
        attachments,
        structure,
        flagged,
        false);
  }

  /** 별표 없이 생성(기존 호출부 호환) — flagged=false. */
  public ParsedMessage(
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
      List<ParsedAttachment> attachments,
      String structure) {
    this(
        imapUid,
        messageId,
        threadId,
        inReplyTo,
        references,
        fromAddress,
        fromName,
        toAddresses,
        ccAddresses,
        subject,
        sentAt,
        receivedAt,
        seen,
        hasAttachment,
        bodyText,
        bodyHtml,
        snippet,
        attachments,
        structure,
        false);
  }

  /** structure 없이 생성(Graph·보낸메일·테스트 경로). IMAP 동기화 경로에서 이 생성자를 쓰면 content 를 공유하지 않는다. */
  public ParsedMessage(
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
      List<ParsedAttachment> attachments) {
    this(
        imapUid,
        messageId,
        threadId,
        inReplyTo,
        references,
        fromAddress,
        fromName,
        toAddresses,
        ccAddresses,
        subject,
        sentAt,
        receivedAt,
        seen,
        hasAttachment,
        bodyText,
        bodyHtml,
        snippet,
        attachments,
        null);
  }
}
