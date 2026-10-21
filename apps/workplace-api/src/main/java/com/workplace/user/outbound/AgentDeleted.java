package com.workplace.user.outbound;

/**
 * AGENT 유저를 삭제한다는 도메인 이벤트. user 모듈이 {@code deleteAgent} 에서 사용자 행을 <b>지우기 전에</b> 같은 트랜잭션으로 발행한다 — 다른
 * 모듈이 그 사용자를 가리키는 데이터(예: 노트 공유·노트 스페이스 멤버십)를 정상 경로(기록·감사·재검증·마지막 OWNER 보호)로 정리할 기회를 갖는다. 행이 지워지면 FK
 * CASCADE 가 조용히 지우거나(공유) NO ACTION FK 가 삭제를 막기(멤버십) 때문이다. 리스너가 예외를 던지면(예: 마지막 OWNER) 삭제 전체가 롤백된다.
 * 정지({@link WorkspaceMembershipSuspended})와 달리 삭제 전에 동기로 처리돼야 해서 별도 이벤트로 둔다. user 가 wiki 등을 직접
 * import 하지 않기 위한 public 계약.
 *
 * <p>테넌트는 발행 시점에 담는다 — 커밋 후·비동기 리스너 스레드에는 요청의 TenantContext 가 없다.
 *
 * @param tenantId 삭제가 일어난 워크스페이스
 * @param userId 삭제되는 에이전트
 * @param actorId 삭제한 관리자 — 정리 과정의 변경 알림(멤버 제거 등)의 행위자
 */
public record AgentDeleted(long tenantId, long userId, long actorId) {}
