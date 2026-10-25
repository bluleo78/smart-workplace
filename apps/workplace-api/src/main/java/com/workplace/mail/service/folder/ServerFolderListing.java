package com.workplace.mail.service.folder;

import java.util.List;

/**
 * 서버 메일함 목록 조회 결과(WP-960). 조회가 끝까지 성공했을 때만 만들어진다 — 일부만 받은 목록으로 저장된 폴더를 지우면 안 되므로, 실패는 예외로 알린다.
 *
 * @param folders 저장 대상(ARCHIVE·USER) 폴더 전부
 * @param inboxRemoteId 받은편지함의 서버 식별자(INBOX 행 remote_id 기록용) — 모르면 null
 */
public record ServerFolderListing(List<ServerFolder> folders, String inboxRemoteId) {}
