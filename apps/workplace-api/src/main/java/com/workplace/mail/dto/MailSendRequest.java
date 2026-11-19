package com.workplace.mail.dto;

import jakarta.validation.Valid;
import jakarta.validation.constraints.Size;
import java.time.OffsetDateTime;
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
 *
 * <p>draftId(WP-577, 선택): 이 발송이 이어받은 내 임시저장 — 발송에 성공하면 지운다(실패하면 남긴다). 없거나 남의 id 면 임시저장 없이 보낸 것과 같다.
 * 내 임시저장(어느 것이든)에 묶인 업로드는 draftId 와 상관없이 attachmentIds 로 다시 쓸 수 있다(남의 임시저장 업로드는 거절). AI
 * 확인카드(MailSendActionParams)는 이 필드를 받지 않는다.
 *
 * <p>inlineUploads(WP-947, 선택): attachmentIds 가운데 본문에 붙여 넣은 이미지 — 본문 HTML 이 {@code cid:} 로 참조한다. 그
 * 업로드는 일반 첨부가 아니라 같은 Content-ID 의 인라인 파트로 붙는다(받는 메일 앱 본문에 그림이 보이게). 보관·클레임·소비는 attachmentIds 와 같다 —
 * 그래서 여기 id 는 attachmentIds 에도 있어야 한다. null/빈 목록이면 붙여 넣은 이미지 없음.
 *
 * <p>mode·sourceMessageId·quoteRemoved(WP-1786, 선택): 작성창의 작성 문맥 — 보내기 대기 행(임시보관)에 그대로 남겨, 10초 안에
 * 되돌리거나 보내지 못해 다시 열 때 전달·답장이 원본 메일 연결(인용문 다시 만들기)을 잃지 않게 한다. mode 는 임시저장과 같은 new·reply·forward.
 * 생략(null)하면 서버가 지금처럼 추정한다(답장 원본이 있으면 reply, 전달 첨부가 있으면 forward) — AI 확인카드 등 기존 호출처 호환. 발송
 * 자체(MIME·스레딩)에는 쓰이지 않는다.
 *
 * <p>sendAt(WP-1787, 선택): 예약 보내기 시각(ISO). 있으면 되돌리기 유예(10초) 대신 이 시각에 보낸다 — 지금부터 1분 뒤 이후여야 하고 한 사용자당
 * 100건까지다. 없으면(null) 지금처럼 즉시 보내기(10초 되돌리기).
 *
 * <p>inlineImages·inlineUploads 는 요청 단계에서 100개 상한(임시저장 요청과 같다, 코드 리뷰) — 보내기 컨트롤러가 {@code @Valid} 로
 * 건다. 실제 발송 상한(인라인 합쳐 20개)은 서비스 검증이 사용자 문구로 따로 본다.
 */
public record MailSendRequest(
    List<String> to,
    List<String> cc,
    List<String> bcc,
    String subject,
    String bodyHtml,
    String bodyText,
    Long inReplyToMessageId,
    @Size(max = MailSendRequest.MAX_INLINE_REFS) @Valid List<InlineImageRef> inlineImages,
    List<Long> attachmentIds,
    List<Long> forwardAttachmentIds,
    Long draftId,
    @Size(max = MailSendRequest.MAX_INLINE_REFS) @Valid List<InlineUploadRef> inlineUploads,
    String mode,
    Long sourceMessageId,
    Boolean quoteRemoved,
    OffsetDateTime sendAt) {

  /**
   * 인라인 참조(inlineImages·inlineUploads) 요청 단계 상한 — 보내기와 임시저장 요청({@link MailDraftSaveRequest})이 같은 값을
   * 쓴다(코드 리뷰). 실제 발송 상한(인라인 합쳐 20개)은 서비스 검증이 따로 본다.
   */
  public static final int MAX_INLINE_REFS = 100;

  /**
   * 목록 필드 생략(null)은 빈 목록으로 정규화 — 소비처가 null 을 다루지 않게 한다. id 목록의 null 원소·중복은 그대로 둔다(발송 검증이 사용자 문구로
   * 거절한다 — List.copyOf 는 null 원소에서 NPE 를 내므로 쓰지 않는다).
   */
  public MailSendRequest {
    inlineImages = inlineImages == null ? List.of() : List.copyOf(inlineImages);
    // null 원소는 발송 검증이 사용자 문구로 거절한다 — List.copyOf 는 null 원소에서 NPE 를 내므로 쓰지 않는다.
    inlineUploads =
        inlineUploads == null
            ? List.of()
            : Collections.unmodifiableList(new ArrayList<>(inlineUploads));
    attachmentIds =
        attachmentIds == null
            ? List.of()
            : Collections.unmodifiableList(new ArrayList<>(attachmentIds));
    forwardAttachmentIds =
        forwardAttachmentIds == null
            ? List.of()
            : Collections.unmodifiableList(new ArrayList<>(forwardAttachmentIds));
  }

  /** 작성 문맥 없는 발송(WP-947 호출처 호환) — 대기 행의 mode·원본은 서버가 추정한다. */
  public MailSendRequest(
      List<String> to,
      List<String> cc,
      List<String> bcc,
      String subject,
      String bodyHtml,
      String bodyText,
      Long inReplyToMessageId,
      List<InlineImageRef> inlineImages,
      List<Long> attachmentIds,
      List<Long> forwardAttachmentIds,
      Long draftId,
      List<InlineUploadRef> inlineUploads) {
    this(
        to,
        cc,
        bcc,
        subject,
        bodyHtml,
        bodyText,
        inReplyToMessageId,
        inlineImages,
        attachmentIds,
        forwardAttachmentIds,
        draftId,
        inlineUploads,
        null,
        null,
        null,
        null);
  }

  /** 붙여 넣은 본문 이미지 없는 발송(WP-577 호출처 호환). */
  public MailSendRequest(
      List<String> to,
      List<String> cc,
      List<String> bcc,
      String subject,
      String bodyHtml,
      String bodyText,
      Long inReplyToMessageId,
      List<InlineImageRef> inlineImages,
      List<Long> attachmentIds,
      List<Long> forwardAttachmentIds,
      Long draftId) {
    this(
        to,
        cc,
        bcc,
        subject,
        bodyHtml,
        bodyText,
        inReplyToMessageId,
        inlineImages,
        attachmentIds,
        forwardAttachmentIds,
        draftId,
        (List<InlineUploadRef>) null);
  }

  /** 임시저장 없는 발송(WP-574 호출처 호환). */
  public MailSendRequest(
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
    this(
        to,
        cc,
        bcc,
        subject,
        bodyHtml,
        bodyText,
        inReplyToMessageId,
        inlineImages,
        attachmentIds,
        forwardAttachmentIds,
        null);
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
    this(
        to,
        cc,
        bcc,
        subject,
        bodyHtml,
        bodyText,
        inReplyToMessageId,
        inlineImages,
        null,
        null,
        null);
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

  /**
   * 본문에 붙여 넣은 이미지 참조(WP-947).
   *
   * @param attachmentId 작성창 업로드 id(attachmentIds 의 원소 = file.id)
   * @param contentId 본문 HTML 의 cid: 값 — 발송 파트의 Content-ID 로 그대로 쓴다
   */
  public record InlineUploadRef(Long attachmentId, String contentId) {}
}
