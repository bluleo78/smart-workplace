package com.workplace.auth.outbound;

/**
 * 사용자가 OAuth 동의 화면에서 「허용」해 앱(Claude 앱 커넥터 등)과의 <b>새</b> 연결이 생겼다(WP-1686) — 알림(notify 모듈)이 커밋 뒤에 받아
 * 연결한 본인 인박스에 「새 앱 연결」을 넣는다(내가 하지 않은 연결을 알아채게). 같은 연결을 다시 허용해 기존 연결을 다시 쓸 때는 내지 않는다 — Claude 가 다시
 * 연결할 때마다 알림이 쌓이지 않게.
 *
 * <p>인가 서비스는 알림 모듈을 직접 알지 못하고 이 이벤트만 발행한다(도메인 간 통신은 이벤트). tenantId 는 발행 시점에 담는다 — 커밋 뒤 비동기 리스너는 요청의
 * TenantContext 를 볼 수 없고, 연결한 워크스페이스가 세션의 워크스페이스와 다를 수도 있다.
 *
 * @param tenantId 연결한 워크스페이스(알림이 들어갈 인박스의 테넌트)
 * @param userId 연결한 본인(알림 받는 사람)
 * @param clientName 연결한 앱 이름(알림 message·푸시 문구에 보인다)
 */
public record OAuthConnectionCreatedEvent(long tenantId, long userId, String clientName) {}
