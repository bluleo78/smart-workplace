package com.workplace.mail.dto;

/**
 * 서명 이미지 하나의 발송용 사본(WP-1517).
 *
 * @param imageId 서명 이미지 id
 * @param uploadId 새로 만든 작성창 업로드(스테이징 file) id — 본문 src 를 {@code /api/v1/files/{uploadId}/content} 로
 *     바꿔 붙여 넣은 이미지(WP-947)처럼 보낸다
 */
public record SignatureImageStaged(long imageId, long uploadId) {}
