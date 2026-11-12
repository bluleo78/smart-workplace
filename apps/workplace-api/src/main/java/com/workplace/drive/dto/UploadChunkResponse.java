package com.workplace.drive.dto;

/**
 * 조각 PUT 응답(WP-1520).
 *
 * @param receivedBytes 이 조각까지 받은 바이트 — 다음 조각의 offset
 */
public record UploadChunkResponse(long receivedBytes) {}
