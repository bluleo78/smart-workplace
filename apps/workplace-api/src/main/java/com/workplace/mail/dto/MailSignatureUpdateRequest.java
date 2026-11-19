package com.workplace.mail.dto;

/**
 * 메일 서명 저장 요청(WP-1517). html·autoNew·autoReply 는 꼭 있어야 한다(null 이면 400).
 *
 * @param html 붙여 넣은 서명 HTML — 이미지는 data: 나 외부 URL 그대로 실어도 된다(서버가 받아 저장한다)
 * @param autoNew 새 메일에 자동으로 넣는다
 * @param autoReply 답장·전달에 자동으로 넣는다
 * @param pasted 붙여넣은 서명을 「원본 그대로」 저장한다(WP-1726) — 설정 화면이 편집기 대신 미리 보기로 연다. null(필드를 모르는 옛 웹)은 false
 */
public record MailSignatureUpdateRequest(
    String html, Boolean autoNew, Boolean autoReply, Boolean pasted) {}
