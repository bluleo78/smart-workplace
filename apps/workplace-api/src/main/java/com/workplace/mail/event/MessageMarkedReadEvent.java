package com.workplace.mail.event;

/**
 * 메시지가 처음 읽음(seen false→true)으로 전이됐을 때 발행하는 도메인 이벤트.
 *
 * <p>비동기 리스너({@link com.workplace.mail.service.MailReadSyncListener})가 수신해 원본 서버(Graph/IMAP)에
 * isRead 를 역동기화한다. best-effort — 발행 또는 동기화 실패 시 로컬 읽음 상태에는 영향 없음.
 *
 * @param tenantId 이벤트 발행 시점의 테넌트 ID (비동기 스레드에서 TenantContext 재주입에 사용)
 * @param userId 읽음 처리를 수행한 사용자 ID
 * @param messageId email_message.id
 */
public record MessageMarkedReadEvent(long tenantId, long userId, long messageId) {}
