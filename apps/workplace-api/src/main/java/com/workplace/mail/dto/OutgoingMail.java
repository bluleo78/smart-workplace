package com.workplace.mail.dto;

import com.workplace.file.service.MimeNormalizer;
import java.time.Instant;
import java.util.List;

/**
 * 발송 파이프라인 내부 캐리어. MailTransport(전송)·EmailMessageRepository.insertSent(로컬 저장)가 공유한다.
 * messageId/inReplyTo 는 꺾쇠 없는 정규화 id, references 는 꺾쇠 포함 원문(파서 저장 규칙과 일치).
 *
 * <p>inlineImages(WP-69): 본문 cid: 참조에 대응하는 인라인 이미지 파트(바이트 확보 완료). 빈 목록이면 multipart/alternative 만
 * 조립한다.
 *
 * <p>attachments(WP-574): 일반 첨부 파일(작성창 업로드 + 전달 원본 첨부, 바이트 확보 완료). 비어 있지 않으면 MIME 바깥을
 * multipart/mixed 로 감싼다.
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
    List<InlineImagePart> inlineImages,
    List<AttachmentPart> attachments) {

  /** inlineImages·attachments null 은 빈 목록으로 정규화. */
  public OutgoingMail {
    inlineImages = inlineImages == null ? List.of() : List.copyOf(inlineImages);
    attachments = attachments == null ? List.of() : List.copyOf(attachments);
  }

  /**
   * Message-ID 를 바꾼 사본(WP-574) — 공급자가 실제로 붙인 값으로 로컬 SENT 행을 남길 때. 새 스레드(자기 Message-ID 가 스레드 루트)였다면
   * 스레드 id 도 같이 바꾼다.
   */
  public OutgoingMail withMessageId(String actualMessageId) {
    String thread = messageId != null && messageId.equals(threadId) ? actualMessageId : threadId;
    return new OutgoingMail(
        actualMessageId,
        thread,
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
        inlineImages,
        attachments);
  }

  /** 일반 첨부를 뺀 사본 — Graph 큰 메일 경로가 첨부를 API 로 따로 붙일 초안 MIME 을 만들 때 쓴다. */
  public OutgoingMail withoutAttachments() {
    return new OutgoingMail(
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
        inlineImages,
        List.of());
  }

  /**
   * 인라인 이미지 파트.
   *
   * @param contentId Content-ID 헤더 값(꺾쇠 제외) — 본문 cid: 참조와 정확히 일치해야 한다
   * @param filename 파일명(없으면 null)
   * @param contentType image/* MIME 타입
   * @param content 이미지 바이트
   * @param contentHash 바이트의 sha256(원본 첨부 캐시 키를 이미 알면 그 값, 모르면 null — WP-574 기록이 다시 해시하지 않게)
   */
  public record InlineImagePart(
      String contentId, String filename, String contentType, byte[] content, String contentHash) {

    /** 해시를 모르는 파트 — 보낸 메일 기록 때 계산한다. */
    public InlineImagePart(String contentId, String filename, String contentType, byte[] content) {
      this(contentId, filename, contentType, content, null);
    }
  }

  /**
   * 일반 첨부 파일 파트(WP-574).
   *
   * @param filename 파일명(한글 가능 — MIME 조립 시 RFC 2231/2047 로 인코딩)
   * @param contentType 파일의 MIME 타입(모르면 application/octet-stream)
   * @param content 원본 바이트
   * @param contentHash 바이트의 sha256(전달 원본의 캐시 키를 이미 알면 그 값, 모르면 null — 기록이 다시 해시하지 않게)
   */
  public record AttachmentPart(
      String filename, String contentType, byte[] content, String contentHash) {

    /** 해시를 모르는 파트(업로드 등) — 보낸 메일 기록 때 계산한다. */
    public AttachmentPart(String filename, String contentType, byte[] content) {
      this(filename, contentType, content, null);
    }

    /** 보낼 파일명 — 비었으면 "attachment"(MIME 파트·Graph 첨부 공통). */
    public String filenameOrDefault() {
      return filename == null || filename.isBlank() ? "attachment" : filename;
    }

    /** 보낼 Content-Type — 구체 타입이 아니면 application/octet-stream(MIME 파트·Graph 첨부 공통). */
    public String concreteContentType() {
      return MimeNormalizer.concreteOrOctetStream(contentType);
    }
  }
}
