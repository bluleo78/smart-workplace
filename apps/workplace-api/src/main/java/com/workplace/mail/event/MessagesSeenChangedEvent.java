package com.workplace.mail.event;

import java.util.List;

/**
 * 메일 읽음 상태가 바뀌었을 때(열람·읽음·안읽음·모두 읽음) 발행하는 도메인 이벤트(WP-187 — 첫 열람 전용이던 읽음 이벤트를 일반화).
 *
 * <p>비동기 리스너({@link com.workplace.mail.service.MailReadSyncListener})가 받아 원본 서버(Graph/IMAP)에 처리 시점의
 * DB seen 을 맞춘다. 1통 조작도 id 하나짜리로 같은 경로를 탄다. best-effort — 실패해도 로컬 읽음 상태에는 영향 없음.
 *
 * @param tenantId 발행 시점 테넌트(비동기 스레드 TenantContext 재주입용)
 * @param userId 조작한 사용자
 * @param accountId 메일 계정(한 이벤트의 메일은 모두 같은 계정)
 * @param messageIds email_message.id 목록
 */
public record MessagesSeenChangedEvent(
    long tenantId, long userId, long accountId, List<Long> messageIds) {}
