package com.workplace.mail.dto;

/** 발송 결과. localMessageId 는 보낸편지함 로컬 행 id, messageId 는 생성된 RFC Message-ID(꺾쇠 제외). */
public record SendResult(long localMessageId, String messageId) {}
