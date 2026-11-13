package com.workplace.drive.dto;

import java.time.OffsetDateTime;

/**
 * 나눠 올리기 세션 상태(WP-1520) — 시작(201)과 상태 조회(200)가 같은 모양을 돌려준다.
 *
 * @param id 세션 id(UUID) — 조각 PUT·완료·취소 경로에 쓴다
 * @param chunkSize 화면이 한 번에 보낼 조각 크기(바이트)
 * @param receivedBytes 서버가 지금까지 받은 바이트 — 다음 조각의 offset
 * @param size 전체 바이트 수
 * @param expiresAt 만료 시각 — 조각을 받을 때마다 24시간 뒤로 밀린다. 지나면 세션·받은 바이트가 지워진다
 */
public record UploadSessionResponse(
    String id, long chunkSize, long receivedBytes, long size, OffsetDateTime expiresAt) {}
