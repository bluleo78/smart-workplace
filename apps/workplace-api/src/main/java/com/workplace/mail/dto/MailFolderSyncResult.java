package com.workplace.mail.dto;

import java.time.Instant;

/**
 * 메일함 한 개 동기화 결과(WP-960). 같은 메일함을 이미 가져오는 중이면 running=true 이고 개수는 0 이다 — 오류가 아니라 「진행 중」이므로 화면은 잠시 뒤
 * 목록을 다시 읽으면 된다.
 *
 * @param running 같은 메일함 동기화가 이미 진행 중이라 이번 요청은 아무것도 하지 않았는지
 * @param fetched 서버에서 받은 항목 수
 * @param saved 새로 넣은 메일 수
 * @param seenChanged 서버 읽음 상태를 따라 바뀐 메일 수
 * @param removed 서버에서 사라져 지운 메일 수
 * @param syncedSince 가져온 가장 오래된 수신일 경계
 * @param folderSyncedAt 마지막으로 가져온 시각
 */
public record MailFolderSyncResult(
    boolean running,
    int fetched,
    int saved,
    int seenChanged,
    int removed,
    Instant syncedSince,
    Instant folderSyncedAt) {}
