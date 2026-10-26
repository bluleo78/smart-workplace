package com.workplace.mail.dto;

import java.time.Instant;

/**
 * 받은편지함·보낸편지함 이전 메일 더 가져오기 결과(WP-965). 같은 폴더를 이미 가져오는 중이면 running=true 이고 개수는 0, hasMore 는 true 다 —
 * 화면은 잠시 뒤 목록을 다시 읽고 다시 부르면 된다.
 *
 * @param running 같은 폴더를 이미 가져오는 중이라 이번 요청은 아무것도 하지 않았는지
 * @param fetched 서버에서 받은 항목 수
 * @param saved 새로 넣은 메일 수
 * @param syncedSince 옮긴 가장 오래된 수신일 경계(받지 않았으면 null)
 * @param hasMore 새 경계 앞에 서버 메일이 더 있는지 — false 면 화면은 「더 이전 메일 없음」
 */
public record MailOlderResult(
    boolean running, int fetched, int saved, Instant syncedSince, boolean hasMore) {}
