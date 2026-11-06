// VirtualAttachmentResponse.java
package com.workplace.drive.dto;

import java.time.Instant;

/**
 * 「첨부 모아보기」 한 행.
 *
 * @param fileId file 행 id — 드라이브 가져오기·미리보기 키. MAIL 은 file 행이 없어 null(가져오기 불가 — 가져오기 가능 여부는 이 값의 유무로
 *     판단한다)
 * @param sourceType "ISSUE" | "CHAT_MESSAGE" | "MESSAGE" | "WIKI" | "MAIL"
 * @param kind 출처 안의 세부 종류 — 이슈 본문 이미지면 "BODY_IMAGE", 그 밖은 null
 * @param mailAttachmentId MAIL 전용 — /api/v1/mail/attachments/{id}/… 가 받는 메일 첨부 id. 그 밖은 null
 */
public record VirtualAttachmentResponse(
    Long fileId,
    String name,
    String mimeType,
    long sizeBytes,
    boolean hasThumbnail,
    String sourceType,
    String sourceLabel,
    String deepLink,
    String downloadUrl,
    Instant attachedAt,
    String kind,
    Long mailAttachmentId) {}
