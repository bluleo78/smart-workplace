package com.workplace.mail.dto;

import java.time.Instant;

/**
 * 메일 앱 사이드바용 서버 메일함 한 개(WP-960). 보관(ARCHIVE)과 사용자 메일함(USER)만 내려간다 — 받은편지함·보낸편지함 등은 기존 고정 항목이 맡는다.
 * 트리는 parentId 로 클라이언트가 조립한다.
 *
 * @param id email_folder id
 * @param displayName 표시 이름
 * @param parentId 보이는 부모 폴더 id(최상위면 null)
 * @param role "ARCHIVE" 또는 "USER"
 * @param selectable 메일을 담을 수 있는지(false 면 하위 폴더를 묶는 노드)
 * @param unreadCount 서버 안 읽은 수(모르면 null)
 * @param totalCount 서버 전체 메일 수(모르면 null)
 * @param syncedSince 가져온 가장 오래된 수신일 경계(아직 안 가져왔으면 null)
 * @param folderSyncedAt 이 폴더 메일을 마지막으로 가져온 시각(없으면 null)
 */
public record MailFolderResponse(
    long id,
    String displayName,
    Long parentId,
    String role,
    boolean selectable,
    Integer unreadCount,
    Integer totalCount,
    Instant syncedSince,
    Instant folderSyncedAt) {}
