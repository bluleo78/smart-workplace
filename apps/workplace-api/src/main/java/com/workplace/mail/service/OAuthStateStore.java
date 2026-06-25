package com.workplace.mail.service;

import java.security.SecureRandom;
import java.time.Instant;
import java.util.Base64;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.stereotype.Component;

/**
 * OAuth2 auth-code 흐름의 CSRF 방지용 서버측 state 저장소.
 *
 * <p>start 엔드포인트가 {@link #issue}로 state 문자열을 발급하면, callback 엔드포인트가 {@link #consume}으로 1회 소비한다.
 * consume 이 state 를 제거하므로 replay 공격이 불가하다. TTL(10분) 경과 시 만료로 거부.
 *
 * <p>userId/tenantId 를 state 에 결속하여 JWT 없는 콜백 경로에서 사용자/테넌트 식별에 사용한다.
 */
@Component
public class OAuthStateStore {

  /** state TTL: 10분. AAD 인가 코드 수명(10분)에 맞춘다. */
  private static final java.time.Duration TTL = java.time.Duration.ofMinutes(10);

  private final SecureRandom rng = new SecureRandom();
  // state 문자열 → StateData 맵. ConcurrentHashMap 으로 스레드 안전 보장.
  private final ConcurrentHashMap<String, StateData> store = new ConcurrentHashMap<>();

  /**
   * 새 state 를 발급하고 userId/tenantId 를 결속한다.
   *
   * @param userId JWT에서 추출한 요청자 userId
   * @param tenantId 현재 활성 테넌트 ID (TenantContext.get())
   * @return 무작위 base64url 인코딩된 state 문자열
   */
  public String issue(long userId, long tenantId) {
    byte[] bytes = new byte[32];
    rng.nextBytes(bytes);
    // URL-safe base64(패딩 없음) — query string 전달에 안전
    String state = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    store.put(state, new StateData(userId, tenantId, Instant.now().plus(TTL)));
    return state;
  }

  /**
   * state 를 1회 소비한다. 알 수 없거나 만료된 state 면 empty 반환(CSRF 방어).
   *
   * @param state AAD 콜백에서 전달된 state 파라미터
   * @return 유효한 StateData. 없거나 만료면 Optional.empty()
   */
  public Optional<StateData> consume(String state) {
    StateData data = store.remove(state); // 제거 → replay 불가
    if (data == null) {
      return Optional.empty(); // 알 수 없는 state — CSRF 거부
    }
    if (Instant.now().isAfter(data.expiresAt())) {
      return Optional.empty(); // 만료된 state 거부
    }
    return Optional.of(data);
  }

  /**
   * OAuth state 메타데이터.
   *
   * @param userId 요청자 userId
   * @param tenantId 활성 테넌트 ID
   * @param expiresAt 만료 시각
   */
  public record StateData(long userId, long tenantId, Instant expiresAt) {}
}
