package com.workplace.mail.dto;

import java.time.OffsetDateTime;

/**
 * 메일 작성 첨부 업로드 결과(WP-574) — 작성창이 칩으로 보여 주고, 보낼 때 {@code MailSendRequest.attachmentIds} 에 id 를 넘긴다.
 *
 * @param id 임시 업로드 id(file.id) — 발송 요청의 attachmentIds 값
 * @param name 저장된(정리된) 파일 이름
 * @param size 크기(바이트)
 * @param mimeType 저장 MIME(발송 파트의 Content-Type 이 된다)
 * @param expiresAt 이 시각까지 보내지 않으면 만료 정리가 지운다
 */
public record ComposeAttachmentResponse(
    long id, String name, long size, String mimeType, OffsetDateTime expiresAt) {}
