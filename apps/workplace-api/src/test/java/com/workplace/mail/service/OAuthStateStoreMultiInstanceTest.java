package com.workplace.mail.service;

import static com.workplace.jooq.Tables.MAIL_OAUTH_STATE;
import static com.workplace.jooq.Tables.TENANT;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.global.tenant.TenantContext;
import com.workplace.mail.repository.MailOAuthStateRepository;
import com.workplace.mail.service.OAuthStateStore.StateData;
import com.workplace.support.IntegrationTestBase;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.PlatformTransactionManager;

/**
 * OAuth state 가 DB 에 있어 다른 인스턴스(파드)에서도 소비되는지(WP-1976). 커밋되는 트랜잭션이 필요해 {@code @Transactional} 을 쓰지
 * 않는다. 두 번째 인스턴스는 같은 의존성으로 직접 만든다.
 */
class OAuthStateStoreMultiInstanceTest extends IntegrationTestBase {

  @Autowired MailOAuthStateRepository repo;
  @Autowired PlatformTransactionManager txManager;
  @Autowired OAuthStateStore storeA;

  private final List<Long> extraTenants = new ArrayList<>();

  /** 패키지 전용 생성자로 시계를 주입한 인스턴스를 만든다(같은 패키지의 테스트). */
  private OAuthStateStore newStore(Clock clock) {
    return new OAuthStateStore(repo, txManager, clock);
  }

  private OAuthStateStore storeB() {
    return newStore(Clock.systemUTC());
  }

  @AfterEach
  void cleanup() {
    cleanupInTenant(1L, () -> baseDsl.deleteFrom(MAIL_OAUTH_STATE).execute());
    for (Long t : extraTenants) {
      cleanupInTenant(t, () -> baseDsl.deleteFrom(MAIL_OAUTH_STATE).execute());
    }
    TenantContext.clear();
  }

  private long newTenant() {
    long id =
        baseDsl
            .insertInto(TENANT)
            .set(TENANT.SLUG, "oss-" + UUID.randomUUID().toString().substring(0, 8))
            .set(TENANT.NAME, "OAuth State Tenant")
            .set(TENANT.STATUS, "ACTIVE")
            .returning(TENANT.ID)
            .fetchOne()
            .getId();
    extraTenants.add(id);
    return id;
  }

  @Test
  void issueOnA_consumeOnB_succeedsOnce() {
    TenantContext.set(1L);
    OAuthStateStore b = storeB();
    String state = storeA.issue(42L, 1L);

    Optional<StateData> got = b.consume(state);
    assertThat(got).isPresent();
    assertThat(got.get().userId()).isEqualTo(42L);
    assertThat(got.get().tenantId()).isEqualTo(1L);
    assertThat(b.consume(state)).isEmpty();
    assertThat(storeA.consume(state)).isEmpty();
  }

  @Test
  void expiredState_isRejected() {
    TenantContext.set(1L);
    String state = storeA.issue(42L, 1L);
    OAuthStateStore later =
        newStore(Clock.fixed(Instant.now().plus(Duration.ofMinutes(11)), java.time.ZoneOffset.UTC));
    assertThat(later.consume(state)).isEmpty();
  }

  @Test
  void unknownState_isRejected() {
    TenantContext.set(1L);
    assertThat(storeA.consume("no-such-state")).isEmpty();
    assertThat(storeA.consume(null)).isEmpty();
    assertThat(storeA.consume("  ")).isEmpty();
  }

  @Test
  void concurrentConsume_onlyOneWins() throws Exception {
    TenantContext.set(1L);
    String state = storeA.issue(42L, 1L);
    OAuthStateStore b = storeB();
    CountDownLatch go = new CountDownLatch(1);
    ExecutorService ex = Executors.newFixedThreadPool(2);
    try {
      List<Future<Optional<StateData>>> fs = new ArrayList<>();
      for (OAuthStateStore s : List.of(storeA, b)) {
        fs.add(
            ex.submit(
                () -> {
                  TenantContext.set(1L);
                  try {
                    go.await();
                    return s.consume(state);
                  } finally {
                    TenantContext.clear();
                  }
                }));
      }
      go.countDown();
      long wins = 0;
      for (Future<Optional<StateData>> f : fs) {
        if (f.get().isPresent()) wins++;
      }
      assertThat(wins).isEqualTo(1);
    } finally {
      ex.shutdownNow();
    }
  }

  /**
   * 다른 워크스페이스에서 마친 콜백도 state 를 찾아 발급 테넌트를 돌려준다 — 컨트롤러가 403 tenant_mismatch 로 가르게(RLS 로 못 찾아 400 이
   * 되면 웹이 「다시 시도」로 잘못 안내한다). 요청의 TenantContext 는 그대로 되돌아오고, 행은 지우지 않아 시작한 워크스페이스에서 마칠 수 있다.
   */
  @Test
  void otherTenant_consumeFindsIssuingTenant_withoutUsingItUp() {
    long t2 = newTenant();
    TenantContext.set(1L);
    String state = storeA.issue(42L, 1L);

    TenantContext.set(t2);
    Optional<StateData> got = storeB().consume(state);
    assertThat(got).isPresent();
    assertThat(got.get().tenantId()).isEqualTo(1L);
    assertThat(TenantContext.get()).isEqualTo(t2);

    // 다른 워크스페이스에서는 읽기만 했으니 시작한 워크스페이스에서 한 번 마칠 수 있다.
    TenantContext.set(1L);
    assertThat(storeA.consume(state)).isPresent();
    assertThat(storeA.consume(state)).isEmpty();
  }

  /** 다른 워크스페이스에서 읽은 남의 state 는 discard 로 발급 테넌트에서 지워 더 쓸 수 없다. */
  @Test
  void discard_fromOtherTenant_removesState() {
    long t2 = newTenant();
    TenantContext.set(1L);
    String state = storeA.issue(42L, 1L);

    TenantContext.set(t2);
    storeB().discard(state);
    assertThat(TenantContext.get()).isEqualTo(t2);

    TenantContext.set(1L);
    assertThat(storeA.consume(state)).isEmpty();
  }

  /** 접두(발급 테넌트)를 바꾼 state 는 해시가 달라 어느 테넌트에서도 행을 찾지 못한다 — 원래 state 는 그대로 남는다. */
  @Test
  void tamperedTenantPrefix_isRejected() {
    long t2 = newTenant();
    TenantContext.set(1L);
    String state = storeA.issue(42L, 1L);
    String tampered = t2 + state.substring(state.indexOf('.'));

    assertThat(storeA.consume(tampered)).isEmpty();
    assertThat(storeA.consume("abc" + state.substring(state.indexOf('.')))).isEmpty();
    assertThat(storeA.consume(state)).isPresent();
  }

  @Test
  void nonDefaultTenant_roundTrip() {
    long t2 = newTenant();
    TenantContext.set(t2);
    String state = storeA.issue(7L, t2);

    // 소비 전 DB 행의 tenant_id 확인 — RLS 가 걸린 표라 해당 테넌트 트랜잭션 안에서 읽는다.
    List<Long> rowTenants =
        callInTenant(
            t2,
            () ->
                baseDsl
                    .select(MAIL_OAUTH_STATE.TENANT_ID)
                    .from(MAIL_OAUTH_STATE)
                    .fetch(0, Long.class));
    assertThat(rowTenants).containsExactly(t2);

    Optional<StateData> got = storeA.consume(state);
    assertThat(got).isPresent();
    assertThat(got.get().tenantId()).isEqualTo(t2);
    assertThat(got.get().userId()).isEqualTo(7L);
  }

  @Test
  void stateHashOnly_storedNotRaw() {
    TenantContext.set(1L);
    String state = storeA.issue(42L, 1L);

    // 발급한 state 의 SHA-256 hex 로만 행을 좁힌다(다른 행과 섞이지 않게).
    String expectedHash;
    try {
      expectedHash =
          java.util.HexFormat.of()
              .formatHex(
                  java.security.MessageDigest.getInstance("SHA-256")
                      .digest(state.getBytes(java.nio.charset.StandardCharsets.UTF_8)));
    } catch (java.security.NoSuchAlgorithmException e) {
      throw new IllegalStateException(e);
    }
    var rec =
        baseDsl
            .selectFrom(MAIL_OAUTH_STATE)
            .where(MAIL_OAUTH_STATE.STATE_HASH.eq(expectedHash))
            .fetchOne();
    assertThat(rec).isNotNull();
    assertThat(rec.getStateHash()).matches("[0-9a-f]{64}").isNotEqualTo(state);
    assertThat(rec.toString()).doesNotContain(state);
  }
}
