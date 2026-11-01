package com.workplace.agentruntime.service;

import com.workplace.agentruntime.dto.RunnerPrincipal;
import com.workplace.agentruntime.repository.AgentRunnerTokenRepository;
import com.workplace.global.security.RunnerTokenAuthenticator;
import com.workplace.global.util.CapabilityTokens;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

/**
 * runner 토큰 검증기(WP-1248) — runner 가 보낸 평문 토큰을 SHA-256 해시로 바꿔 활성 토큰을 찾고, 그 토큰이 묶인 테넌트·위치를 돌려준다.
 *
 * <p>테넌트 컨텍스트가 정해지기 <b>전</b>에 불리도록(요청 필터) 일부러 {@code @Transactional} 을 붙이지 않고 RLS 없는 전역 테이블만 다룬다.
 * 성공하면 마지막 사용 시각을 갱신해 위치의 연결 상태(CONNECTED)를 만든다. global 의 runner 인증 필터가 {@link
 * RunnerTokenAuthenticator} 로 부른다(WP-1249).
 */
@Component
@RequiredArgsConstructor
public class RunnerTokenVerifier implements RunnerTokenAuthenticator {

  private final AgentRunnerTokenRepository tokens;

  /** 평문이 비었거나 모르는/회수된 토큰이면 비어 있음. */
  public Optional<RunnerPrincipal> verify(String plaintext) {
    if (plaintext == null || plaintext.isBlank()) {
      return Optional.empty();
    }
    return tokens
        .findActiveByHash(CapabilityTokens.sha256Hex(plaintext))
        .map(
            active -> {
              tokens.touchLastUsed(active.id());
              return active.principal();
            });
  }

  /** 인증 필터용 — 주체는 {@link RunnerPrincipal}(테넌트·위치). */
  @Override
  public Optional<Authenticated> authenticate(String plaintext) {
    return verify(plaintext).map(p -> new Authenticated(p.tenantId(), p));
  }
}
