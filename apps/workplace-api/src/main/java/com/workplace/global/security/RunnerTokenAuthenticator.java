package com.workplace.global.security;

import java.util.Optional;

/**
 * runner 토큰({@code rt_...}) 검증 창구(WP-1249) — 인증 필터({@link RunnerTokenAuthenticationFilter})는 global
 * 에 두고, 토큰 저장소를 아는 실제 검증은 실행 위치 모듈(agentruntime)이 구현한다. global 이 도메인 모듈을 import 하지 않게 하려는 경계다.
 */
public interface RunnerTokenAuthenticator {

  /**
   * 평문 토큰을 검증한다.
   *
   * @return 토큰이 묶인 테넌트와 컨트롤러가 받을 인증 주체. 비었거나 모르는/회수된 토큰이면 empty
   */
  Optional<Authenticated> authenticate(String plaintext);

  /**
   * 검증된 runner 토큰.
   *
   * @param tenantId 토큰을 발급한 워크스페이스 — 필터가 TenantContext 로 세운다
   * @param principal SecurityContext 에 넣을 주체(컨트롤러가 {@code @AuthenticationPrincipal} 로 받는다)
   */
  record Authenticated(long tenantId, Object principal) {}
}
