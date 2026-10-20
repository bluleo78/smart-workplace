package com.workplace.action.dto;

import com.workplace.mail.dto.MailSendRequest;
import java.util.List;

/**
 * AI 확인카드 mail.send 의 params(accountId 제외) — 웹 발송 요청({@link MailSendRequest})과 일부러 따로 둔다(WP-574).
 *
 * <p>첨부 필드(attachmentIds·forwardAttachmentIds)는 없다. 확인카드는 첨부를 보여 주지 않으므로, 받은 메일에 심은 지시로 AI 가 사용자의
 * 민감한 첨부를 forwardAttachmentIds 에 넣어 제안하면 사용자가 모른 채 승인해 파일이 밖으로 나간다. 엄격 매핑(모르는 필드 거절)이라 두 필드가 오면 승인
 * 전에 400 으로 거절된다. 인용문 이미지(inlineImages, WP-69)도 같은 이유로 받지 않는다 — 확인카드에 보이지 않는 사용자의 이미지 첨부를 아무거나 cid
 * 파트로 붙여 내보낼 수 있다(ai-agent·MCP 어디도 보내지 않는다).
 */
public record MailSendActionParams(
    List<String> to,
    List<String> cc,
    List<String> bcc,
    String subject,
    String bodyHtml,
    String bodyText,
    Long inReplyToMessageId) {

  /** 발송 요청으로 옮긴다 — 인용문 이미지·첨부 필드는 늘 빈 목록. */
  public MailSendRequest toRequest() {
    return new MailSendRequest(to, cc, bcc, subject, bodyHtml, bodyText, inReplyToMessageId);
  }
}
