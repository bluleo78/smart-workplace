package com.workplace.mail.service;

import com.workplace.global.tenant.TenantContext;
import com.workplace.global.util.CapabilityTokens;
import com.workplace.mail.repository.MailOAuthStateRepository;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Optional;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * OAuth2 auth-code 흐름의 CSRF 방지용 서버측 state 저장소.
 *
 * <p>start 엔드포인트가 {@link #issue}로 state 문자열을 발급하면, complete 엔드포인트가 {@link #consume}으로 1회 소비한다.
 * state 는 DB(mail_oauth_state)에 SHA-256 해시로만 저장하므로(WP-1976) start 와 complete 가 서로 다른 파드로 가도 동작한다.
 * consume 이 행을 지우므로 replay 가 불가하고, TTL(10분) 경과 시 만료로 거부한다.
 *
 * <p>userId/tenantId 를 state 에 결속하여 사용자/테넌트 식별에 사용한다. 행은 RLS 로 테넌트별로 격리된다.
 */
@Component
public class OAuthStateStore {

  /** state TTL: 10분. AAD 인가 코드 수명(10분)에 맞춘다. */
  private static final Duration TTL = Duration.ofMinutes(10);

  private final MailOAuthStateRepository repo;
  private final TransactionTemplate tx;
  private final Clock clock;

  /** 운영 생성자 — 시스템 UTC 시계. */
  @Autowired
  public OAuthStateStore(MailOAuthStateRepository repo, PlatformTransactionManager txManager) {
    this(repo, txManager, Clock.systemUTC());
  }

  /** 테스트용 생성자 — 시계를 주입한다(만료 검증). TransactionTemplate 을 직접 써서 직접 만든 인스턴스에도 트랜잭션이 걸린다. */
  OAuthStateStore(
      MailOAuthStateRepository repo, PlatformTransactionManager txManager, Clock clock) {
    this.repo = repo;
    this.tx = new TransactionTemplate(txManager);
    this.clock = clock;
  }

  /**
   * 새 state 를 발급하고 userId/tenantId 를 결속한다.
   *
   * @param userId JWT에서 추출한 요청자 userId
   * @param tenantId 현재 활성 테넌트 ID (TenantContext.get())
   * @return 무작위 base64url 인코딩된 state 문자열(원문은 저장하지 않는다)
   */
  public String issue(long userId, long tenantId) {
    // URL-safe base64(패딩 없음, 43자) 난수 — query string 전달에 안전
    String state = CapabilityTokens.generateUrlSafe(32);
    Instant now = clock.instant();
    // RLS GUC 는 트랜잭션 시작 시점의 TenantContext 로 주입된다 — 행이 tenantId 의 테넌트에 쌓이도록 그 값으로 맞췄다가 되돌린다.
    Long prev = TenantContext.get();
    TenantContext.set(tenantId);
    try {
      tx.executeWithoutResult(
          status -> {
            // 발급 때 같은 테넌트의 만료 행을 함께 비워 표가 쌓이지 않게 한다.
            repo.deleteExpired(now);
            repo.insert(CapabilityTokens.sha256Hex(state), userId, now.plus(TTL));
          });
    } finally {
      if (prev == null) TenantContext.clear();
      else TenantContext.set(prev);
    }
    return state;
  }

  /**
   * state 를 1회 소비한다. 알 수 없거나 만료된 state 면 empty 반환(CSRF 방어).
   *
   * @param state AAD 콜백에서 전달된 state 파라미터
   * @return 유효한 StateData. 없거나 만료면 Optional.empty()
   */
  public Optional<StateData> consume(String state) {
    if (state == null || state.isBlank()) {
      return Optional.empty();
    }
    Optional<MailOAuthStateRepository.Row> row =
        tx.execute(status -> repo.deleteReturning(CapabilityTokens.sha256Hex(state)));
    if (row == null || row.isEmpty()) {
      return Optional.empty(); // 알 수 없는 state(또는 다른 테넌트) — CSRF 거부
    }
    MailOAuthStateRepository.Row r = row.get();
    if (clock.instant().isAfter(r.expiresAt())) {
      return Optional.empty(); // 만료된 state 거부(행은 이미 지워졌다)
    }
    return Optional.of(new StateData(r.userId(), r.tenantId(), r.expiresAt()));
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
