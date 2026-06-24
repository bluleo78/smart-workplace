package com.workplace.mail.dto;

/** 초안 코칭 요청(미영속). inReplyToMessageId=null 이면 새 메일(스레드 없음). */
public record MailDraftCoachingRequest(
    long accountId, String bodyHtml, String bodyText, Long inReplyToMessageId) {}
