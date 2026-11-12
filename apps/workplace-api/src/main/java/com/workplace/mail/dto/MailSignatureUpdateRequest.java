package com.workplace.mail.dto;

/**
 * 메일 서명 저장 요청(WP-1517). 모든 값이 필요하다(null 이면 400).
 *
 * @param html 붙여 넣은 서명 HTML — 이미지는 data: 나 외부 URL 그대로 실어도 된다(서버가 받아 저장한다)
 * @param autoNew 새 메일에 자동으로 넣는다
 * @param autoReply 답장·전달에 자동으로 넣는다
 */
public record MailSignatureUpdateRequest(String html, Boolean autoNew, Boolean autoReply) {}
