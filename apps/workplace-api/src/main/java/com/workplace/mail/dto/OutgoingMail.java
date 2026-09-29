package com.workplace.mail.dto;

import java.time.Instant;
import java.util.List;

/**
 * 발송 파이프라인 내부 캐리어. MailTransport(전송)·EmailMessageRepository.insertSent(로컬 저장)가 공유한다.
 * messageId/inReplyTo 는 꺾쇠 없는 정규화 id, references 는 꺾쇠 포함 원문(파서 저장 규칙과 일치).
 *
 * <p>inlineImages(WP-69): 본문 cid: 참조에 대응하는 인라인 이미지 파트(바이트 확보 완료). 빈 목록이면 multipart/alternative 만
 * 조립한다.
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
    Instant sentAt,
    List<InlineImagePart> inlineImages) {

  /** inlineImages null 은 빈 목록으로 정규화. */
  public OutgoingMail {
    inlineImages = inlineImages == null ? List.of() : List.copyOf(inlineImages);
  }

  /** 인라인 이미지 없는 발송(기존 호출처 호환). */
  public OutgoingMail(
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
      Instant sentAt) {
    this(
        messageId,
        threadId,
        fromAddress,
        fromName,
        to,
        cc,
        bcc,
        subject,
        bodyText,
        bodyHtml,
        inReplyTo,
        references,
        snippet,
        sentAt,
        List.of());
  }

  /**
   * 인라인 이미지 파트.
   *
   * @param contentId Content-ID 헤더 값(꺾쇠 제외) — 본문 cid: 참조와 정확히 일치해야 한다
   * @param filename 파일명(없으면 null)
   * @param contentType image/* MIME 타입
   * @param content 이미지 바이트
   */
  public record InlineImagePart(
      String contentId, String filename, String contentType, byte[] content) {}
}
