package com.workplace.file.dto;

import java.time.OffsetDateTime;

/**
 * 스테이징 파일(WP-421) — 도메인 쓰기({@code fileIds})에 넘길 임시 첨부. 텍스트 만들기·링크 PUT 이 같은 모양으로 돌려준다.
 *
 * @param fileId 클레임에 넘길 file.id
 * @param name 저장된(정리된) 파일 이름
 * @param sizeBytes 크기(바이트)
 * @param mimeType 저장 MIME
 * @param expiresAt 이 시각까지 클레임하지 않으면 만료 정리가 지운다
 */
public record StagedFileResponse(
    long fileId, String name, long sizeBytes, String mimeType, OffsetDateTime expiresAt) {}
