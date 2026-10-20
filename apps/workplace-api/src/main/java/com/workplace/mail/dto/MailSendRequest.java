package com.workplace.mail.dto;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/**
 * 메일 발송 요청(새 메일·답장·전달 공용). to/cc/bcc 는 주소 문자열 리스트. bodyHtml/bodyText 는 클라이언트 Tiptap 의
 * getHTML()/getText() 결과. inReplyToMessageId 가 있으면 답장으로 처리해 부모의 Message-ID/References/thread_id 를
 * 상속한다(없으면 새 스레드).
 *
 * <p>inlineImages(WP-69, 선택): 답장·전달 인용문이 {@code cid:} 로 참조하는 원본 메일 첨부. 발송 시 서버가 원본 바이트를 가져와 같은
 * Content-ID 의 인라인 파트로 다시 붙인다. null/빈 목록이면 인라인 파트 없음(AI 에이전트 등 기존 호출처 호환).
 *
 * <p>attachmentIds(WP-574, 선택): 작성창이 {@code POST /api/v1/mail/compose-attachments} 로 먼저 올린 임시 첨부
 * id(= file.id, 스테이징 파일과 같은 규칙 — 내가 올렸고 만료 전이어야 한다). 발송에 성공하면 만료 처리된다.
 *
 * <p>forwardAttachmentIds(WP-574, 선택): 전달할 받은 메일의 원본 첨부(email_attachment.id, 내 계정 메일이어야 한다). 발송 때
 * 서버가 원본 바이트를 받아 일반 첨부로 붙인다.
 *
 * <p>첨부 원본 합계(attachmentIds + forwardAttachmentIds + inlineImages)는 메일 한 통에 25MB 까지다. 두 필드 모두
 * null/빈 목록이면 첨부 없이 지금처럼 보낸다(AI 확인카드 등 기존 호출처 호환).
 */
public record MailSendRequest(
    List<String> to,
    List<String> cc,
    List<String> bcc,
    String subject,
    String bodyHtml,
    String bodyText,
    Long inReplyToMessageId,
    List<InlineImageRef> inlineImages,
    List<Long> attachmentIds,
    List<Long> forwardAttachmentIds) {

  /**
   * 목록 필드 생략(null)은 빈 목록으로 정규화 — 소비처가 null 을 다루지 않게 한다. id 목록의 null 원소·중복은 그대로 둔다(발송 검증이 사용자 문구로
   * 거절한다 — List.copyOf 는 null 원소에서 NPE 를 내므로 쓰지 않는다).
   */
  public MailSendRequest {
    inlineImages = inlineImages == null ? List.of() : List.copyOf(inlineImages);
    attachmentIds =
        attachmentIds == null
            ? List.of()
            : Collections.unmodifiableList(new ArrayList<>(attachmentIds));
    forwardAttachmentIds =
        forwardAttachmentIds == null
            ? List.of()
            : Collections.unmodifiableList(new ArrayList<>(forwardAttachmentIds));
  }

  /** 일반 첨부 없는 발송(WP-69 인라인 이미지 호출처 호환). */
  public MailSendRequest(
      List<String> to,
      List<String> cc,
      List<String> bcc,
      String subject,
      String bodyHtml,
      String bodyText,
      Long inReplyToMessageId,
      List<InlineImageRef> inlineImages) {
    this(to, cc, bcc, subject, bodyHtml, bodyText, inReplyToMessageId, inlineImages, null, null);
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
