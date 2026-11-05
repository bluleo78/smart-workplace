package com.workplace.search.dto;

import java.time.Instant;

/**
 * 통합 검색 「메일」 한 건(WP-1359) — 메일과 그 메일이 든 메일함. 웹은 folderKind 로 메일함을 연 채 메일로 가는 주소를 만들고, 오른쪽 meta(메일함
 * 이름 · 사람)를 만든다.
 *
 * @param folderKind "INBOX"(받은편지함) · "SENT"(보낸편지함 — 앱 발송 기록과 서버 보낸편지함 모두) · "OTHER"(보관함·사용자 메일함)
 * @param folderId OTHER 일 때만 그 메일함 id(웹 {@code ?box=}), 나머지는 null
 * @param folderName 메일함 표시 이름 — 「받은편지함」·「보낸편지함」, 그 밖은 표시 이름(없으면 서버 이름)
 * @param firstRecipient SENT 일 때만 첫 받는 사람(이름이 있으면 이름, 없으면 주소), 나머지는 null
 * @param recipientCount SENT 일 때만 받는 사람(to) 수, 나머지는 0
 */
public record MailSearchHit(
    long id,
    long accountId,
    String subject,
    String snippet,
    String fromAddress,
    String fromName,
    Instant receivedAt,
    String folderKind,
    Long folderId,
    String folderName,
    String firstRecipient,
    int recipientCount) {}
