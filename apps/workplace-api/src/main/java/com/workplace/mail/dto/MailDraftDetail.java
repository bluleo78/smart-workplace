package com.workplace.mail.dto;

import java.time.OffsetDateTime;
import java.util.List;

/**
 * 임시저장 상세(WP-577) — 작성창을 다시 열 때 쓴다. 답장·전달 인용은 웹이 sourceMessageId 로 다시 만든다.
 *
 * @param attachments 전달 원본 첨부(원본이 지워져 가져올 수 없는 것은 빠진다) 다음 업로드 첨부
 * @param version 다음 수정(PUT)에 넘길 낙관적 잠금 버전
 */
public record MailDraftDetail(
    long id,
    long accountId,
    String mode,
    List<String> to,
    List<String> cc,
    List<String> bcc,
    String subject,
    String bodyHtml,
    Long sourceMessageId,
    boolean quoteRemoved,
    List<Attachment> attachments,
    int version,
    OffsetDateTime updatedAt) {

  /** 업로드 첨부 출처. */
  public static final String SOURCE_UPLOAD = "upload";

  /** 전달 원본 첨부 출처. */
  public static final String SOURCE_FORWARD = "forward";

  /**
   * 임시저장 첨부 한 건.
   *
   * @param id upload 면 file.id(발송의 attachmentIds), forward 면 email_attachment.id(발송의
   *     forwardAttachmentIds)
   * @param source upload·forward
   */
  public record Attachment(long id, String name, long size, String mimeType, String source) {}
}
