package com.workplace.mail.dto;

import com.workplace.mail.dto.MailSendRequest.InlineImageRef;
import com.workplace.mail.dto.MailSendRequest.InlineUploadRef;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.util.List;
import java.util.Set;

/**
 * 메일 임시저장 생성·수정 요청(WP-577) — 작성창 자동 저장이 보낸다. 자동 저장이라 빈 값·형식이 틀린 주소도 받는다(주소 형식 검증은 발송 때만).
 *
 * <p>받는사람 수·주소 길이·제목 길이 상한은 정리(빈 값 제거)한 뒤 서비스가 MailComposeLimits 로 거른다 — 발송과 같은 검사·같은 문구. bodyHtml
 * 은 UTF-8 2MB 상한을 서비스가 본다(문자 수가 아니라 바이트라 애노테이션으로 못 건다) — 발송에는 걸지 않는다(인용한 원본이 붙어 더 클 수 있다).
 *
 * @param accountId 보낼 계정(본인 활성 계정이어야 한다, 아니면 404)
 * @param mode new·reply·forward. 생략하면 new
 * @param bodyText 본문 텍스트 — 목록 미리보기(앞 120자)를 만들고, 대기열이 보낼 때 평문 파트로 쓰도록 body_text 에도 저장한다(WP-1786)
 * @param sourceMessageId 답장·전달의 원본 메일 id(웹이 인용을 다시 만든다). 확인하지 않고 그대로 둔다
 * @param attachmentIds 작성 첨부 업로드 id — 저장할 때 임시저장에 묶이고, 빠진 것은 풀린다
 * @param forwardAttachmentIds 전달 원본 첨부(email_attachment.id) — 내 메일 첨부만 남기고 나머지는 버린다
 * @param inlineImages 답장·전달 인용이 cid 로 참조하는 원본 메일 첨부(WP-1786, 보내기 요청 전체를 담는다)
 * @param inlineUploads 본문에 붙여 넣은 이미지 업로드(WP-1786)
 * @param inReplyToMessageId 답장 원본 메일 id — 스레딩 헤더용(WP-1786)
 * @param confidential 기밀 표시(WP-2029) — 보낼 때 제목 머리말·Sensitivity 헤더로 이어진다. null 이면 false
 * @param version 수정(PUT) 때 필수 — 마지막으로 받은 버전(낙관적 잠금). 생성(POST)은 무시한다
 */
public record MailDraftSaveRequest(
    @NotNull Long accountId,
    @Pattern(regexp = MailDraftSaveRequest.MODE_PATTERN) String mode,
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
    Integer version,
    // 인라인 참조도 첨부 id 목록과 같은 상한 — 자동 저장 한 번에 거대한 JSON 배열이 행에 쌓이지 않게(코드 리뷰).
    @Size(max = MailSendRequest.MAX_INLINE_REFS) @Valid List<InlineImageRef> inlineImages,
    @Size(max = MailSendRequest.MAX_INLINE_REFS) @Valid List<InlineUploadRef> inlineUploads,
    Long inReplyToMessageId,
    Boolean confidential) {

  /** 작성 모드 패턴(new·reply·forward) — 요청 검증(@Pattern)과 {@link #MODES} 가 같은 정의를 쓴다. */
  public static final String MODE_PATTERN = "new|reply|forward";

  /** 받는 작성 모드 — 보내기 대기열이 작성창이 실은 mode 를 그대로 쓸지 판단할 때도 쓴다(WP-1786). */
  public static final Set<String> MODES = Set.of(MODE_PATTERN.split("\\|"));

  /** 본문 HTML 상한(UTF-8 바이트) — 2MB. 인라인 이미지는 cid 참조라 본문에 바이트가 실리지 않는다. */
  public static final int MAX_BODY_HTML_BYTES = 2 * 1024 * 1024;

  /** 본문 텍스트 상한(문자) — 미리보기만 만들지만 요청 폭주를 막는다(HTML 상한과 같은 크기). */
  public static final int MAX_BODY_TEXT_CHARS = 2 * 1024 * 1024;
}
