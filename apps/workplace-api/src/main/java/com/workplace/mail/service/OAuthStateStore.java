package com.workplace.mail.service;

import com.workplace.global.tenant.TenantContext;
import com.workplace.global.util.CapabilityTokens;
import com.workplace.mail.repository.MailOAuthStateRepository;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Optional;
import java.util.function.Supplier;
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
 * <p>userId/tenantId 를 state 에 결속하여 사용자/테넌트 식별에 사용한다. 행은 RLS 로 테넌트별로 격리된다. state 문자열 앞에 발급한 테넌트 id
 * 를 붙여({@code <tenantId>.<난수>}) consume 이 지금 요청의 워크스페이스와 상관없이 발급한 테넌트의 행을 찾는다 — 다른 워크스페이스에서 마친 콜백도
 * state 를 찾아 컨트롤러가 403 tenant_mismatch(「시작한 워크스페이스에서 마치세요」)로 답하게 한다(RLS 로 못 찾아 400 invalid_request
 * 로 바뀌면 웹이 「다시 시도」로 잘못 안내한다). 해시가 state 전체(접두 포함)를 덮으므로 접두를 바꾼 state 는 어느 테넌트에서도 행을 찾지 못한다.
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
    // 발급 테넌트 접두 + URL-safe base64(패딩 없음, 43자) 난수 — '.' 도 query string 전달에 안전하다.
    String state = tenantId + PREFIX_SEPARATOR + CapabilityTokens.generateUrlSafe(32);
    Instant now = clock.instant();
    inTenant(
        tenantId,
        () -> {
          // 발급 때 같은 테넌트의 만료 행을 함께 비워 표가 쌓이지 않게 한다.
          repo.deleteExpired(now);
          repo.insert(CapabilityTokens.sha256Hex(state), userId, now.plus(TTL));
          return null;
        });
    return state;
  }

  /**
   * state 를 1회 소비한다. 알 수 없거나 만료된 state 면 empty 반환(CSRF 방어).
   *
   * <p>발급한 워크스페이스가 지금 요청의 워크스페이스와 다르면 지우지 않고 읽기만 해서 돌려준다 — 컨트롤러가 403 tenant_mismatch 로 답한 뒤 사용자가
   * 시작한 워크스페이스의 탭에서 같은 state 로 마칠 수 있게. 남의 state(사용자 불일치)는 컨트롤러가 {@link #discard} 로 지운다.
   *
   * @param state AAD 콜백에서 전달된 state 파라미터
   * @return 유효한 StateData. 없거나 만료면 Optional.empty()
   */
  public Optional<StateData> consume(String state) {
    if (state == null || state.isBlank()) {
      return Optional.empty();
    }
    // 접두의 발급 테넌트에서 찾는다 — 지금 요청의 워크스페이스가 달라도 행을 찾아 컨트롤러가 tenant_mismatch 로 가른다.
    // 접두가 없거나 숫자가 아니면 지금 테넌트에서 찾는다(그런 state 는 발급한 적이 없어 결국 empty).
    Long current = TenantContext.get();
    Long issuedTenant = tenantPrefix(state);
    Long lookupTenant = issuedTenant != null ? issuedTenant : current;
    String hash = CapabilityTokens.sha256Hex(state);
    boolean sameTenant = lookupTenant != null && lookupTenant.equals(current);
    Optional<MailOAuthStateRepository.Row> row =
        lookupTenant == null
            ? Optional.empty()
            : inTenant(
                lookupTenant,
                () -> sameTenant ? repo.deleteReturning(hash) : repo.findByHash(hash));
    if (row == null || row.isEmpty()) {
      return Optional.empty(); // 알 수 없는 state — CSRF 거부
    }
    MailOAuthStateRepository.Row r = row.get();
    if (clock.instant().isAfter(r.expiresAt())) {
      return Optional.empty(); // 만료된 state 거부(같은 워크스페이스면 행은 이미 지워졌고, 아니면 다음 발급 때 정리된다)
    }
    return Optional.of(new StateData(r.userId(), r.tenantId(), r.expiresAt()));
  }

  /**
   * state 를 발급 테넌트에서 지운다 — 다른 워크스페이스에서 읽기만 한 남의 state(사용자 불일치)를 더 쓸 수 없게 할 때 컨트롤러가 부른다. 없으면 조용히
   * 넘어간다.
   */
  public void discard(String state) {
    if (state == null || state.isBlank()) return;
    Long issuedTenant = tenantPrefix(state);
    Long lookupTenant = issuedTenant != null ? issuedTenant : TenantContext.get();
    if (lookupTenant == null) return;
    String hash = CapabilityTokens.sha256Hex(state);
    inTenant(lookupTenant, () -> repo.deleteReturning(hash));
  }

  /** state 의 발급 테넌트 접두와 난수를 가르는 문자. */
  private static final String PREFIX_SEPARATOR = ".";

  /** state 앞의 발급 테넌트 id 를 읽는다. 없거나 숫자가 아니면 null. */
  private static Long tenantPrefix(String state) {
    int dot = state.indexOf(PREFIX_SEPARATOR);
    if (dot <= 0) return null;
    try {
      return Long.parseLong(state.substring(0, dot));
    } catch (NumberFormatException e) {
      return null;
    }
  }

  /**
   * 주어진 테넌트로 짧은 트랜잭션을 돌린다. RLS GUC 는 트랜잭션 시작 시점의 TenantContext 로 주입되므로 그 값으로 맞췄다가 끝나면 되돌린다(요청의 테넌트를
   * 컨트롤러가 이어 쓴다).
   */
  private <T> T inTenant(long tenantId, Supplier<T> work) {
    Long prev = TenantContext.get();
    TenantContext.set(tenantId);
    try {
      return tx.execute(status -> work.get());
    } finally {
      if (prev == null) TenantContext.clear();
      else TenantContext.set(prev);
    }
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
