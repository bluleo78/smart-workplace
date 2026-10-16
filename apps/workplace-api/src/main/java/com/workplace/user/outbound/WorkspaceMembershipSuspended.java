package com.workplace.user.outbound;

/**
 * 워크스페이스 관리자가 한 사용자의 멤버십을 정지했다는 도메인 이벤트(WP-420). user 모듈이 {@code setUserActive(false)} 에서 발행하고, 실시간
 * 연결을 가진 모듈(SSE 스트림·노트 공동편집)이 커밋 후 그 사용자의 열린 연결을 닫거나 재검증하는 신호로 쓴다 — user 가 wiki 등을 직접 import 하지 않기
 * 위한 public 계약.
 *
 * <p>테넌트는 발행 시점에 담는다 — 커밋 후·비동기 리스너 스레드에는 요청의 TenantContext 가 없다.
 *
 * @param tenantId 정지가 일어난 워크스페이스
 * @param userId 정지된 사용자
 */
public record WorkspaceMembershipSuspended(long tenantId, long userId) {}
