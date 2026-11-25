package com.workplace.auth.outbound;

import java.util.List;

/**
 * AI 가 사용 한도에 걸려 쉬기 시작했다(WP-2108) — 알림(notify 모듈)이 커밋 뒤에 받아 수신자 인박스에 넣는다. 대기가 새로 시작될 때만 발행한다(같은 대기
 * 안의 반복 실패는 알리지 않는다). tenantId 는 발행 시점에 담는다 — 커밋 뒤 비동기 리스너는 요청의 TenantContext 를 볼 수 없다.
 *
 * @param recipientIds 알림 받는 사람들
 * @param actorId 한도에 걸린 AI 사용자(비서 AGENT 등)
 * @param scope {@code PERSONAL_ASSISTANT} · {@code WORKSPACE_ASSISTANT} · {@code AGENT_ACCOUNT}
 * @param message 알림 본문(서버가 KST 시각까지 만든 문구)
 */
public record AiLimitWaitNoticeEvent(
    long tenantId, List<Long> recipientIds, Long actorId, String scope, String message) {}
