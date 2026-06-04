package com.workplace.mail.dto;

import java.util.List;

/**
 * 메일 발송 요청(새 메일·답장·전달 공용). to/cc/bcc 는 주소 문자열 리스트. bodyHtml/bodyText 는 클라이언트 Tiptap 의
 * getHTML()/getText() 결과. inReplyToMessageId 가 있으면 답장으로 처리해 부모의 Message-ID/References/thread_id 를
 * 상속한다(없으면 새 스레드).
 */
public record MailSendRequest(
    List<String> to,
    List<String> cc,
    List<String> bcc,
    String subject,
    String bodyHtml,
    String bodyText,
    Long inReplyToMessageId) {}
