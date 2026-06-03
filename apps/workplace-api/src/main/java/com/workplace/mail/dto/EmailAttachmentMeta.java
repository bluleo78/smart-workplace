package com.workplace.mail.dto;

/** 첨부 메타데이터(바이너리 미저장 — 다운로드는 후속). */
public record EmailAttachmentMeta(
    long id, String filename, String contentType, long sizeBytes, String contentId) {}
