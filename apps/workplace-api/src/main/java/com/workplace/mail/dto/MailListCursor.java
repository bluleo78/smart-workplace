package com.workplace.mail.dto;

import java.time.Instant;

/**
 * 메일 목록 다음 페이지 커서(WP-965) — 앞 페이지 마지막 행의 정렬 키. 목록 정렬(received_at 내림차순·NULL 은 뒤, id 내림차순)에서 이 행 바로
 * 뒤부터 읽는다.
 *
 * @param receivedAt 마지막 행의 수신 시각(NULL 이면 수신 시각 없는 구간)
 * @param id 마지막 행의 id
 */
public record MailListCursor(Instant receivedAt, long id) {}
