package com.workplace.auth.outbound;

/**
 * 주인이 아닌 사람(관리자)이 개인 비서의 AI 연결을 회수했다(WP-1170) — 알림(notify 모듈)이 커밋 뒤에 받아 주인 인박스에 「다시 연결해 주세요」를 넣는다.
 * 자격 증명 서비스는 알림 모듈을 직접 알지 못하고 이 이벤트만 발행한다(도메인 간 통신은 이벤트). tenantId 는 발행 시점에 담는다 — 커밋 뒤 비동기 리스너는 요청의
 * TenantContext 를 볼 수 없다.
 *
 * @param ownerId 개인 비서의 주인(알림 받는 사람)
 * @param actorId 회수한 사람
 */
public record PersonalAssistantCredentialRevokedEvent(long tenantId, long ownerId, long actorId) {}
