package com.workplace.mail.dto;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.util.List;

/**
 * 메일 임시저장 생성·수정 요청(WP-577) — 작성창 자동 저장이 보낸다. 자동 저장이라 빈 값·형식이 틀린 주소도 받는다(주소 형식 검증은 발송 때만).
 *
 * <p>받는사람 수·주소 길이·제목 길이 상한은 정리(빈 값 제거)한 뒤 서비스가 MailComposeLimits 로 거른다 — 발송과 같은 검사·같은 문구. bodyHtml
 * 은 UTF-8 2MB 상한을 서비스가 본다(문자 수가 아니라 바이트라 애노테이션으로 못 건다) — 발송에는 걸지 않는다(인용한 원본이 붙어 더 클 수 있다).
 *
 * @param accountId 보낼 계정(본인 활성 계정이어야 한다, 아니면 404)
 * @param mode new·reply·forward. 생략하면 new
 * @param bodyText 본문 텍스트 — 저장하지 않고 목록 미리보기(앞 120자)만 만든다
 * @param sourceMessageId 답장·전달의 원본 메일 id(웹이 인용을 다시 만든다). 확인하지 않고 그대로 둔다
 * @param attachmentIds 작성 첨부 업로드 id — 저장할 때 임시저장에 묶이고, 빠진 것은 풀린다
 * @param forwardAttachmentIds 전달 원본 첨부(email_attachment.id) — 내 메일 첨부만 남기고 나머지는 버린다
 * @param version 수정(PUT) 때 필수 — 마지막으로 받은 버전(낙관적 잠금). 생성(POST)은 무시한다
 */
public record MailDraftSaveRequest(
    @NotNull Long accountId,
    @Pattern(regexp = "new|reply|forward") String mode,
    List<String> to,
    List<String> cc,
    List<String> bcc,
    String subject,
    String bodyHtml,
    @Size(max = MailDraftSaveRequest.MAX_BODY_TEXT_CHARS) String bodyText,
    Long sourceMessageId,
    Boolean quoteRemoved,
    @Size(max = 100) List<Long> attachmentIds,
    @Size(max = 100) List<Long> forwardAttachmentIds,
    Integer version) {

  /** 본문 HTML 상한(UTF-8 바이트) — 2MB. 인라인 이미지는 cid 참조라 본문에 바이트가 실리지 않는다. */
  public static final int MAX_BODY_HTML_BYTES = 2 * 1024 * 1024;

  /** 본문 텍스트 상한(문자) — 미리보기만 만들지만 요청 폭주를 막는다(HTML 상한과 같은 크기). */
  public static final int MAX_BODY_TEXT_CHARS = 2 * 1024 * 1024;
}
