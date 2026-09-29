package com.workplace.mail.dto;

import java.util.List;

/**
 * 메일 발송 요청(새 메일·답장·전달 공용). to/cc/bcc 는 주소 문자열 리스트. bodyHtml/bodyText 는 클라이언트 Tiptap 의
 * getHTML()/getText() 결과. inReplyToMessageId 가 있으면 답장으로 처리해 부모의 Message-ID/References/thread_id 를
 * 상속한다(없으면 새 스레드).
 *
 * <p>inlineImages(WP-69, 선택): 답장·전달 인용문이 {@code cid:} 로 참조하는 원본 메일 첨부. 발송 시 서버가 원본 바이트를 가져와 같은
 * Content-ID 의 인라인 파트로 다시 붙인다. null/빈 목록이면 인라인 파트 없음(AI 에이전트 등 기존 호출처 호환).
 */
public record MailSendRequest(
    List<String> to,
    List<String> cc,
    List<String> bcc,
    String subject,
    String bodyHtml,
    String bodyText,
    Long inReplyToMessageId,
    List<InlineImageRef> inlineImages) {

  /** inlineImages 생략(null)은 빈 목록으로 정규화 — 소비처가 null 을 다루지 않게 한다. */
  public MailSendRequest {
    inlineImages = inlineImages == null ? List.of() : List.copyOf(inlineImages);
  }

  /** 인라인 이미지 없는 발송(기존 호출처 호환). */
  public MailSendRequest(
      List<String> to,
      List<String> cc,
      List<String> bcc,
      String subject,
      String bodyHtml,
      String bodyText,
      Long inReplyToMessageId) {
    this(to, cc, bcc, subject, bodyHtml, bodyText, inReplyToMessageId, null);
  }

  /**
   * 인용문 인라인 이미지 참조.
   *
   * @param attachmentId 원본 메일 email_attachment.id (소유 검증 대상)
   * @param contentId 본문 HTML 의 cid: 값(URL 디코딩, 대소문자 보존) — 발송 파트의 Content-ID 로 그대로 쓴다
   */
  public record InlineImageRef(Long attachmentId, String contentId) {}
}
