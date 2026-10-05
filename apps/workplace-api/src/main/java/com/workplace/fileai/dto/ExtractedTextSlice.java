package com.workplace.fileai.dto;

/**
 * 추출 텍스트 구간 읽기 응답(WP-242). status 가 READY 가 아니면 text·totalChars·nextOffset 은 null 이고 사유만 채운다.
 *
 * @param offset 요청 offset(코드포인트)
 * @param nextOffset 다음 구간 시작. 끝에 도달했거나 READY 가 아니면 null
 */
public record ExtractedTextSlice(
    long fileId,
    String status,
    Integer offset,
    Integer totalChars,
    Boolean truncated,
    Integer nextOffset,
    String text,
    String reasonCode,
    String reason) {}
