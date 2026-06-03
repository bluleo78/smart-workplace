package com.workplace.mail.dto;

/** IMAP 파싱 단계의 첨부 메타(내부 캐리어). 바이너리는 저장하지 않는다. */
public record ParsedAttachment(
    String filename, String contentType, long sizeBytes, String contentId) {}
