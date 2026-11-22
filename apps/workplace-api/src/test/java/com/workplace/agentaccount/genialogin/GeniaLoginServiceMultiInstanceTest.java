package com.workplace.agentaccount.genialogin;

import static com.workplace.jooq.Tables.AGENT_ACCOUNT;
import static com.workplace.jooq.Tables.GENIA_LOGIN_SESSION;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;

import com.workplace.agentaccount.dto.GeniaLoginResponse;
import com.workplace.agentaccount.dto.GeniaLoginStartRequest;
import com.workplace.agentaccount.exception.GeniaLoginNotFoundException;
import com.workplace.agentaccount.genialogin.GeniaLoginClient.LoginStart;
import com.workplace.agentaccount.genialogin.GeniaLoginClient.PollResult;
import com.workplace.agentaccount.service.AgentAccountService;
import com.workplace.global.security.EncryptionService;
import com.workplace.global.tenant.TenantContext;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.PlatformTransactionManager;

/**
 * Gen:iA 로그인 진행이 DB 에 있어 다른 인스턴스(파드)에서도 이어지는지(WP-1976) — 한 파드에서 시작하고 다른 파드에서 조회·취소·폴링한다. 커밋되는 트랜잭션이
 * 필요해 {@code @Transactional} 을 쓰지 않는다. 두 번째 인스턴스는 같은 의존성으로 직접 만들고 시계를 옮겨 폴링 간격·임대 만료를 재현한다. Gen:iA
 * 서버는 MockitoBean 스텁이며 토큰 값은 모두 가짜다.
 */
class GeniaLoginServiceMultiInstanceTest extends IntegrationTestBase {

  private static final String STATE = "st-SECRET-multi-instance";
  private static final String AUTHORIZE_URL = "https://login.example.test/authorize?client=x";
  private static final Instant TOKEN_EXPIRES = Instant.parse("2026-12-12T00:00:00Z");

  @Autowired GeniaLoginClient client;
  @Autowired AgentAccountService accountService;
  @Autowired GeniaLoginSessionRepository repo;
  @Autowired EncryptionService encryption;
  @Autowired PlatformTransactionManager txManager;

  private final List<Long> tenants = new ArrayList<>();
  private long user;
  private long user2;
  private Instant t0;

  @BeforeEach
  void seed() {
    TenantContext.set(1L);
    user = TestFixtures.activeMemberOfCurrentTenant(baseDsl, TestFixtures.createHuman(baseDsl));
    user2 = TestFixtures.activeMemberOfCurrentTenant(baseDsl, TestFixtures.createHuman(baseDsl));
    tenants.add(1L);
    t0 = Instant.now();
  }

  @AfterEach
  void cleanup() {
    for (Long t : tenants) {
      cleanupInTenant(
          t,
          () -> {
            baseDsl.deleteFrom(GENIA_LOGIN_SESSION).execute();
            baseDsl
                .deleteFrom(AGENT_ACCOUNT)
                .where(AGENT_ACCOUNT.CREATED_BY.in(user, user2))
                .execute();
          });
    }
    TenantContext.clear();
  }

  /** 지정 시각으로 고정한 서비스 인스턴스 — 같은 의존성을 공유하는 다른 파드를 흉내 낸다. */
  private GeniaLoginService instance(Instant at) {
    return new GeniaLoginService(
        client,
        accountService,
        repo,
        encryption,
        txManager,
        Clock.fixed(at, ZoneOffset.UTC),
        GeniaLoginService.MIN_POLL_LEASE);
  }

  private GeniaLoginService instanceA() {
    return instance(t0);
  }

  /** 폴링 간격(1초)이 지난 뒤의 인스턴스. */
  private GeniaLoginService instanceB() {
    return instance(t0.plusSeconds(5));
  }

  /** Gen:iA 시작 스텁 — 간격 1초, 10분 뒤 만료(시계를 옮겨도 만료되지 않게 t0 기준이 아니라 넉넉히). */
  private void stubStart() throws Exception {
    doReturn(new LoginStart(AUTHORIZE_URL, STATE, 1, Instant.now().plusSeconds(600)))
        .when(client)
        .start(anyString());
  }

  private static PollResult.Success success(String email) {
    return new PollResult.Success("tok-multi", TOKEN_EXPIRES, email, "member");
  }

  private long accountCount() {
    return baseDsl.fetchCount(AGENT_ACCOUNT, AGENT_ACCOUNT.CREATED_BY.eq(user));
  }

  @Test
  void startOnA_pollOnB_savesAccount() throws Exception {
    stubStart();
    doReturn(success("a@iacloud.kr")).when(client).poll(anyString(), anyString());
    GeniaLoginService a = instanceA();
    String id = a.start(user, new GeniaLoginStartRequest("라벨", null)).id();

    GeniaLoginResponse viaB = instanceB().status(user, id);
    assertThat(viaB.status()).isEqualTo("SUCCEEDED");
    assertThat(viaB.accountId()).isNotNull();
    assertThat(accountCount()).isEqualTo(1);

    // 같은 결과를 다른 파드에서도 멱등으로 받는다 — 폴링이 더 일어나지 않는다.
    GeniaLoginResponse viaA = instance(t0.plusSeconds(10)).status(user, id);
    assertThat(viaA.status()).isEqualTo("SUCCEEDED");
    assertThat(viaA.accountId()).isEqualTo(viaB.accountId());
    verify(client, times(1)).poll(anyString(), anyString());
    assertThat(accountCount()).isEqualTo(1);
  }

  @Test
  void cancelOnB_thenStatusOnA_404() throws Exception {
    stubStart();
    GeniaLoginService a = instanceA();
    String id = a.start(user, new GeniaLoginStartRequest(null, null)).id();

    instanceB().cancel(user, id);

    assertThatThrownBy(() -> a.status(user, id)).isInstanceOf(GeniaLoginNotFoundException.class);
  }

  @Test
  void concurrentStatus_pollsOnce() throws Exception {
    stubStart();
    CountDownLatch entered = new CountDownLatch(1);
    CountDownLatch release = new CountDownLatch(1);
    doAnswer(
            inv -> {
              entered.countDown();
              release.await(10, TimeUnit.SECONDS);
              return new PollResult.Pending();
            })
        .when(client)
        .poll(anyString(), anyString());
    GeniaLoginService a = instance(t0.plusSeconds(5));
    String id = instanceA().start(user, new GeniaLoginStartRequest(null, null)).id();

    CompletableFuture<GeniaLoginResponse> first =
        CompletableFuture.supplyAsync(
            () -> {
              TenantContext.set(1L);
              try {
                return a.status(user, id);
              } finally {
                TenantContext.clear();
              }
            });
    assertThat(entered.await(10, TimeUnit.SECONDS)).isTrue();
    // 첫 조회가 임대를 쥐고 폴링 중 — 다른 파드의 조회는 폴링하지 않고 지금 상태를 돌려준다.
    GeniaLoginResponse second = instanceB().status(user, id);
    assertThat(second.status()).isEqualTo("PENDING");
    release.countDown();
    assertThat(first.get(10, TimeUnit.SECONDS).status()).isEqualTo("PENDING");

    verify(client, times(1)).poll(anyString(), anyString());
  }

  @Test
  void cancelDuringPoll_doesNotSaveAccount() throws Exception {
    stubStart();
    CountDownLatch entered = new CountDownLatch(1);
    CountDownLatch release = new CountDownLatch(1);
    doAnswer(
            inv -> {
              entered.countDown();
              release.await(10, TimeUnit.SECONDS);
              return success("a@iacloud.kr");
            })
        .when(client)
        .poll(anyString(), anyString());
    String id = instanceA().start(user, new GeniaLoginStartRequest(null, null)).id();
    GeniaLoginService b = instanceB();

    CompletableFuture<Object> polling =
        CompletableFuture.supplyAsync(
            () -> {
              TenantContext.set(1L);
              try {
                return b.status(user, id);
              } catch (GeniaLoginNotFoundException e) {
                return e;
              } finally {
                TenantContext.clear();
              }
            });
    assertThat(entered.await(10, TimeUnit.SECONDS)).isTrue();
    // 폴링 응답을 기다리는 사이 다른 파드에서 취소가 끝난다.
    instanceA().cancel(user, id);
    release.countDown();
    polling.get(10, TimeUnit.SECONDS);

    assertThat(accountCount()).isZero();
  }

  /**
   * 폴링(임대 유효) 중에 만료 시각이 지나도 다른 파드의 조회가 진행을 EXPIRED 로 끝내지 않는다 — 끝내면 폴링이 성공해 계정이 저장되는데 사용자는 EXPIRED 를
   * 보는 불일치가 생긴다. 임대가 살아 있는 동안은 폴링이 먼저 끝나고, 최종 상태는 SUCCEEDED 와 저장된 계정이 일치해야 한다.
   */
  @Test
  void expiryDuringLivePoll_otherInstanceDoesNotExpire_consistentResult() throws Exception {
    // 만료 t0+20, 폴링은 t0+5 에 시작(임대 ~t0+35), 다른 파드는 t0+25 에 조회 — 만료는 지났지만 임대는 살아 있다.
    doReturn(new LoginStart(AUTHORIZE_URL, STATE, 1, t0.plusSeconds(20)))
        .when(client)
        .start(anyString());
    CountDownLatch entered = new CountDownLatch(1);
    CountDownLatch release = new CountDownLatch(1);
    doAnswer(
            inv -> {
              entered.countDown();
              release.await(10, TimeUnit.SECONDS);
              return success("a@iacloud.kr");
            })
        .when(client)
        .poll(anyString(), anyString());
    String id = instanceA().start(user, new GeniaLoginStartRequest(null, null)).id();
    GeniaLoginService poller = instanceB();

    CompletableFuture<GeniaLoginResponse> polling =
        CompletableFuture.supplyAsync(
            () -> {
              TenantContext.set(1L);
              try {
                return poller.status(user, id);
              } finally {
                TenantContext.clear();
              }
            });
    assertThat(entered.await(10, TimeUnit.SECONDS)).isTrue();
    // 폴링 응답을 기다리는 사이 만료 시각이 지난 다른 파드가 조회한다 — 임대가 살아 있어 EXPIRED 로 끝내지 않는다.
    GeniaLoginResponse during = instance(t0.plusSeconds(25)).status(user, id);
    assertThat(during.status()).isEqualTo("PENDING");
    release.countDown();
    polling.get(10, TimeUnit.SECONDS);

    // 결과가 일관된다 — 계정이 저장됐으면 상태도 SUCCEEDED.
    GeniaLoginResponse last = instance(t0.plusSeconds(26)).status(user, id);
    assertThat(last.status()).isEqualTo("SUCCEEDED");
    assertThat(last.accountId()).isNotNull();
    assertThat(accountCount()).isEqualTo(1);
  }

  /**
   * 임대를 쥔 파드가 폴링 중에 죽으면(임대만 남음) 임대 안에서는 다른 파드도 폴링하지 않고, 임대가 지나면 이어받아 폴링한다. 죽은 파드는 임대를 직접 잡아 흉내
   * 낸다(폴링 예외는 이제 FAILED 로 끝내 임대를 풀기 때문이다).
   */
  @Test
  void leaseExpired_otherInstanceContinues() throws Exception {
    stubStart();
    doReturn(new PollResult.Pending()).when(client).poll(anyString(), anyString());
    String id = instanceA().start(user, new GeniaLoginStartRequest(null, null)).id();

    // 죽은 파드가 t0+5 에 잡은 임대(30초)가 남아 있다.
    Boolean leased =
        callInTenant(
            1L,
            () ->
                repo.tryAcquireLease(
                    id,
                    java.util.UUID.randomUUID(),
                    t0.plusSeconds(5),
                    t0.plusSeconds(5).plus(GeniaLoginService.MIN_POLL_LEASE)));
    assertThat(leased).isTrue();
    // 임대 안에서는 다른 파드도 폴링하지 않는다.
    assertThat(instance(t0.plusSeconds(20)).status(user, id).status()).isEqualTo("PENDING");
    verify(client, times(0)).poll(anyString(), anyString());
    // 임대가 지나면 이어받아 폴링한다.
    assertThat(instance(t0.plusSeconds(36)).status(user, id).status()).isEqualTo("PENDING");
    verify(client, times(1)).poll(anyString(), anyString());
  }

  /** 폴링 중 예상하지 못한 예외는 조회를 500 으로 끝내지 않고 FAILED 로 끝내며 비밀·임대를 푼다 — 같은 예외를 임대 시간마다 되풀이하지 않는다. */
  @Test
  void pollThrows_endsFailed_andReleasesLease() throws Exception {
    stubStart();
    doAnswer(
            inv -> {
              throw new IllegalStateException("예상 못 한 오류");
            })
        .when(client)
        .poll(anyString(), anyString());
    String id = instanceA().start(user, new GeniaLoginStartRequest(null, null)).id();

    GeniaLoginResponse res = instanceB().status(user, id);

    assertThat(res.status()).isEqualTo("FAILED");
    assertThat(res.errorMessage()).isEqualTo(GeniaLoginService.MSG_POLL_ERROR);
    var row =
        callInTenant(
            1L,
            () ->
                baseDsl
                    .selectFrom(GENIA_LOGIN_SESSION)
                    .where(GENIA_LOGIN_SESSION.LOGIN_ID.eq(id))
                    .fetchOne());
    assertThat(row.getPollLeaseToken()).isNull();
    assertThat(row.getVerifierEnc()).isNull();
    assertThat(row.getStateEnc()).isNull();
    // 끝났으니 다른 파드가 다시 폴링하지 않는다.
    assertThat(instance(t0.plusSeconds(60)).status(user, id).status()).isEqualTo("FAILED");
    verify(client, times(1)).poll(anyString(), anyString());
  }

  /**
   * 저장 직전 임대 연장은 Gen:iA 응답을 받은 뒤의 시각으로 한다 — 폴링 전 시각으로 연장하면 응답을 기다린 만큼 임대가 짧아져 계정 저장 중에 다른 파드가 이어받을
   * 수 있다. 시계를 폴링 응답 때 옮겨 연장한 임대 만료가 옮긴 시각 + 임대인지 본다.
   */
  @Test
  void claimForSave_extendsLeaseFromNow_notPollStart() throws Exception {
    stubStart();
    MutableClock clock = new MutableClock(t0.plusSeconds(5));
    Instant afterPoll = t0.plusSeconds(25);
    doAnswer(
            inv -> {
              clock.set(afterPoll); // Gen:iA 응답에 20초 걸렸다.
              return success("a@iacloud.kr");
            })
        .when(client)
        .poll(anyString(), anyString());
    GeniaLoginSessionRepository spyRepo =
        org.mockito.Mockito.spy(new GeniaLoginSessionRepository(baseDsl));
    GeniaLoginService svc =
        new GeniaLoginService(
            client,
            accountService,
            spyRepo,
            encryption,
            txManager,
            clock,
            GeniaLoginService.MIN_POLL_LEASE);
    String id = instanceA().start(user, new GeniaLoginStartRequest(null, null)).id();

    assertThat(svc.status(user, id).status()).isEqualTo("SUCCEEDED");

    verify(spyRepo)
        .claimForSave(
            org.mockito.ArgumentMatchers.eq(id),
            org.mockito.ArgumentMatchers.eq(user),
            org.mockito.ArgumentMatchers.any(),
            org.mockito.ArgumentMatchers.eq(afterPoll),
            org.mockito.ArgumentMatchers.eq(afterPoll.plus(GeniaLoginService.MIN_POLL_LEASE)));
    assertThat(accountCount()).isEqualTo(1);
  }

  /**
   * 계정을 저장한 뒤 성공 반영이 임대 토큰 불일치로 0건이면(저장하는 사이 다른 파드가 이어받음) 아직 대기 중인 행에 토큰 없이 성공을 반영한다 — 계정은 저장됐는데
   * 화면은 대기·실패로 남는 불일치를 막는다.
   */
  @Test
  void finishZeroRowsAfterSave_recordsSuccessOnPendingRow() throws Exception {
    stubStart();
    doReturn(success("a@iacloud.kr")).when(client).poll(anyString(), anyString());
    GeniaLoginSessionRepository spyRepo =
        org.mockito.Mockito.spy(new GeniaLoginSessionRepository(baseDsl));
    doReturn(false)
        .when(spyRepo)
        .finish(
            anyString(),
            org.mockito.ArgumentMatchers.any(),
            org.mockito.ArgumentMatchers.any(),
            org.mockito.ArgumentMatchers.eq("SUCCEEDED"),
            org.mockito.ArgumentMatchers.any(),
            org.mockito.ArgumentMatchers.any(),
            org.mockito.ArgumentMatchers.any());
    GeniaLoginService svc =
        new GeniaLoginService(
            client,
            accountService,
            spyRepo,
            encryption,
            txManager,
            Clock.fixed(t0.plusSeconds(5), ZoneOffset.UTC),
            GeniaLoginService.MIN_POLL_LEASE);
    String id = instanceA().start(user, new GeniaLoginStartRequest(null, null)).id();

    GeniaLoginResponse res = svc.status(user, id);

    assertThat(res.status()).isEqualTo("SUCCEEDED");
    assertThat(res.accountId()).isNotNull();
    assertThat(accountCount()).isEqualTo(1);
    var row =
        callInTenant(
            1L,
            () ->
                baseDsl
                    .selectFrom(GENIA_LOGIN_SESSION)
                    .where(GENIA_LOGIN_SESSION.LOGIN_ID.eq(id))
                    .fetchOne());
    assertThat(row.getVerifierEnc()).isNull();
    assertThat(row.getPollLeaseToken()).isNull();
  }

  /** 창을 닫아 버려진(만료가 지난) 진행의 암호문은 쓸기(만료 + 10분) 전이라도 다음 시작 때 지운다. */
  @Test
  void abandonedSession_secretsClearedOnNextStart() throws Exception {
    doReturn(new LoginStart(AUTHORIZE_URL, STATE, 1, t0.plusSeconds(20)))
        .when(client)
        .start(anyString());
    String abandoned = instanceA().start(user2, new GeniaLoginStartRequest(null, null)).id();

    // 만료(t0+20)와 여유(1분) 뒤, 쓸기(t0+20+10분) 전에 다른 사용자가 시작한다.
    instance(t0.plusSeconds(120)).start(user, new GeniaLoginStartRequest(null, null));

    var row =
        callInTenant(
            1L,
            () ->
                baseDsl
                    .selectFrom(GENIA_LOGIN_SESSION)
                    .where(GENIA_LOGIN_SESSION.LOGIN_ID.eq(abandoned))
                    .fetchOne());
    assertThat(row).isNotNull();
    assertThat(row.getVerifierEnc()).isNull();
    assertThat(row.getStateEnc()).isNull();
  }

  /** 만료가 지난 지 여유(1분)가 안 됐으면 다른 사용자의 시작이 비밀을 지우지 않는다 — 시계가 조금 늦은 파드가 아직 폴링할 수 있다. */
  @Test
  void justExpiredSession_secretsKeptWithinGrace() throws Exception {
    doReturn(new LoginStart(AUTHORIZE_URL, STATE, 1, t0.plusSeconds(20)))
        .when(client)
        .start(anyString());
    String id = instanceA().start(user2, new GeniaLoginStartRequest(null, null)).id();

    instance(t0.plusSeconds(30)).start(user, new GeniaLoginStartRequest(null, null));

    var row =
        callInTenant(
            1L,
            () ->
                baseDsl
                    .selectFrom(GENIA_LOGIN_SESSION)
                    .where(GENIA_LOGIN_SESSION.LOGIN_ID.eq(id))
                    .fetchOne());
    assertThat(row.getVerifierEnc()).isNotNull();
    assertThat(row.getStateEnc()).isNotNull();
  }

  /** 비밀이 지워진 대기 진행을 폴링하게 되면(시계가 어긋난 파드) 복호화 오류 대신 EXPIRED 로 끝낸다. */
  @Test
  void pollWithClearedSecrets_endsExpired() throws Exception {
    stubStart();
    String id = instanceA().start(user, new GeniaLoginStartRequest(null, null)).id();
    callInTenant(
        1L,
        () ->
            baseDsl
                .update(GENIA_LOGIN_SESSION)
                .setNull(GENIA_LOGIN_SESSION.VERIFIER_ENC)
                .setNull(GENIA_LOGIN_SESSION.STATE_ENC)
                .where(GENIA_LOGIN_SESSION.LOGIN_ID.eq(id))
                .execute());

    assertThat(instanceB().status(user, id).status()).isEqualTo("EXPIRED");
    verify(client, times(0)).poll(anyString(), anyString());
  }

  /** 만료가 지났는데 다른 파드의 임대가 살아 있어 EXPIRED 로 끝내지 못해도, 이미 만료된 로그인 링크는 내보내지 않는다. */
  @Test
  void expiredWithLiveLease_hidesAuthorizeUrl() throws Exception {
    doReturn(new LoginStart(AUTHORIZE_URL, STATE, 1, t0.plusSeconds(20)))
        .when(client)
        .start(anyString());
    String id = instanceA().start(user, new GeniaLoginStartRequest(null, null)).id();
    callInTenant(
        1L,
        () ->
            repo.tryAcquireLease(
                id, java.util.UUID.randomUUID(), t0.plusSeconds(15), t0.plusSeconds(45)));

    GeniaLoginResponse res = instance(t0.plusSeconds(25)).status(user, id);

    assertThat(res.status()).isEqualTo("PENDING");
    assertThat(res.authorizeUrl()).isNull();
  }

  /** 테스트 안에서 옮길 수 있는 시계 — 폴링 응답을 기다린 시간을 흉내 낸다. */
  private static final class MutableClock extends Clock {
    private volatile Instant now;

    MutableClock(Instant start) {
      this.now = start;
    }

    void set(Instant t) {
      this.now = t;
    }

    @Override
    public java.time.ZoneId getZone() {
      return ZoneOffset.UTC;
    }

    @Override
    public Clock withZone(java.time.ZoneId zone) {
      return this;
    }

    @Override
    public Instant instant() {
      return now;
    }
  }

  @Test
  void onePerUser_acrossInstances() throws Exception {
    stubStart();
    String first = instanceA().start(user, new GeniaLoginStartRequest(null, null)).id();
    String second = instanceB().start(user, new GeniaLoginStartRequest(null, null)).id();

    assertThat(second).isNotEqualTo(first);
    assertThatThrownBy(() -> instanceA().status(user, first))
        .isInstanceOf(GeniaLoginNotFoundException.class);
    assertThat(instanceA().status(user, second).status()).isEqualTo("PENDING");
    long rows = callInTenant(1L, () -> baseDsl.fetchCount(GENIA_LOGIN_SESSION));
    assertThat(rows).isEqualTo(1);
  }

  @Test
  void otherUser_404_and_cancelIgnored() throws Exception {
    stubStart();
    String id = instanceA().start(user, new GeniaLoginStartRequest(null, null)).id();

    assertThatThrownBy(() -> instanceB().status(user2, id))
        .isInstanceOf(GeniaLoginNotFoundException.class);
    instanceB().cancel(user2, id); // 남의 진행 취소는 조용히 무시된다.
    assertThat(instanceA().status(user, id).status()).isEqualTo("PENDING");
  }

  @Test
  void nonDefaultTenant_roundTrip() throws Exception {
    long t2 = ensureFixtureTenant("genia-login-t2");
    tenants.add(t2);
    TestFixtures.ensureActiveMember(baseDsl, user, t2);
    stubStart();
    // 실제 포트를 치지 않도록 폴링은 대기 중으로 스텁한다.
    doReturn(new PollResult.Pending()).when(client).poll(anyString(), anyString());
    TenantContext.set(t2);

    String id = instanceA().start(user, new GeniaLoginStartRequest(null, null)).id();
    GeniaLoginResponse r = instanceB().status(user, id);

    assertThat(r.status()).isEqualTo("PENDING");
    List<Long> rowTenants =
        callInTenant(
            t2,
            () ->
                baseDsl
                    .select(GENIA_LOGIN_SESSION.TENANT_ID)
                    .from(GENIA_LOGIN_SESSION)
                    .fetch(0, Long.class));
    assertThat(rowTenants).containsExactly(t2);
    // 다른 테넌트에서는 보이지 않는다.
    TenantContext.set(1L);
    assertThatThrownBy(() -> instanceA().status(user, id))
        .isInstanceOf(GeniaLoginNotFoundException.class);
  }

  @Test
  void secretsEncryptedAndClearedOnFinish() throws Exception {
    stubStart();
    AtomicReference<String> polledVerifier = new AtomicReference<>();
    doAnswer(
            inv -> {
              polledVerifier.set(inv.getArgument(1));
              return success("a@iacloud.kr");
            })
        .when(client)
        .poll(anyString(), anyString());
    String id = instanceA().start(user, new GeniaLoginStartRequest(null, null)).id();

    var pending =
        callInTenant(
            1L,
            () ->
                baseDsl
                    .selectFrom(GENIA_LOGIN_SESSION)
                    .where(GENIA_LOGIN_SESSION.LOGIN_ID.eq(id))
                    .fetchOne());
    assertThat(pending.getStateEnc()).isNotNull().isNotEqualTo(STATE);
    assertThat(encryption.decrypt(pending.getStateEnc())).isEqualTo(STATE);
    assertThat(pending.getVerifierEnc()).isNotNull();

    assertThat(instanceB().status(user, id).status()).isEqualTo("SUCCEEDED");

    assertThat(encryption.decrypt(pending.getVerifierEnc())).isEqualTo(polledVerifier.get());
    var done =
        callInTenant(
            1L,
            () ->
                baseDsl
                    .selectFrom(GENIA_LOGIN_SESSION)
                    .where(GENIA_LOGIN_SESSION.LOGIN_ID.eq(id))
                    .fetchOne());
    assertThat(done.getVerifierEnc()).isNull();
    assertThat(done.getStateEnc()).isNull();
  }

  /**
   * 폴링 응답을 받은 뒤 저장 직전에 임대가 끊겨 다른 파드가 임대를 이어받으면, 처음 폴링한 쪽은 계정을 저장하지 않는다(WP-1976) — 이어받은 쪽과 겹쳐 두 번
   * 등록하거나 UI 가 보는 상태와 어긋나는 것을 막는다. 최종 상태는 PENDING(이어받은 쪽이 아직 대기 응답을 받음)이고 계정은 0개다.
   */
  @Test
  void leaseLapsesDuringPoll_staleSaveIsSkipped() throws Exception {
    stubStart();
    CountDownLatch entered = new CountDownLatch(1);
    CountDownLatch release = new CountDownLatch(1);
    java.util.concurrent.atomic.AtomicInteger calls =
        new java.util.concurrent.atomic.AtomicInteger();
    doAnswer(
            inv -> {
              if (calls.getAndIncrement() == 0) {
                entered.countDown();
                release.await(10, TimeUnit.SECONDS);
                return success("a@iacloud.kr");
              }
              return new PollResult.Pending();
            })
        .when(client)
        .poll(anyString(), anyString());
    String id = instanceA().start(user, new GeniaLoginStartRequest(null, null)).id();
    GeniaLoginService stale = instanceB();

    CompletableFuture<GeniaLoginResponse> polling =
        CompletableFuture.supplyAsync(
            () -> {
              TenantContext.set(1L);
              try {
                return stale.status(user, id);
              } finally {
                TenantContext.clear();
              }
            });
    assertThat(entered.await(10, TimeUnit.SECONDS)).isTrue();
    // 임대(약 30초)가 끊긴 시각의 다른 파드가 임대를 이어받아 폴링하고(대기) 임대를 푼다.
    GeniaLoginResponse taken = instance(t0.plusSeconds(100)).status(user, id);
    assertThat(taken.status()).isEqualTo("PENDING");
    release.countDown();
    polling.get(10, TimeUnit.SECONDS);

    assertThat(accountCount()).isZero();
    assertThat(instance(t0.plusSeconds(100)).status(user, id).status()).isEqualTo("PENDING");
  }

  /** 폴링 성공을 받은 뒤 저장 직전에(임대 확인 전에) 취소가 커밋되면 계정을 저장하지 않는다. 취소(행 삭제)로 확인한다. */
  @Test
  void cancelCommittedBeforeClaim_doesNotSaveAccount() throws Exception {
    stubStart();
    CountDownLatch entered = new CountDownLatch(1);
    CountDownLatch release = new CountDownLatch(1);
    doAnswer(
            inv -> {
              entered.countDown();
              release.await(10, TimeUnit.SECONDS);
              return success("a@iacloud.kr");
            })
        .when(client)
        .poll(anyString(), anyString());
    String id = instanceA().start(user, new GeniaLoginStartRequest(null, null)).id();
    GeniaLoginService b = instanceB();

    CompletableFuture<GeniaLoginResponse> polling =
        CompletableFuture.supplyAsync(
            () -> {
              TenantContext.set(1L);
              try {
                return b.status(user, id);
              } finally {
                TenantContext.clear();
              }
            });
    assertThat(entered.await(10, TimeUnit.SECONDS)).isTrue();
    new org.springframework.transaction.support.TransactionTemplate(txManager)
        .executeWithoutResult(s -> repo.deleteByLoginId(id, user));
    release.countDown();
    GeniaLoginResponse res = polling.get(10, TimeUnit.SECONDS);

    assertThat(accountCount()).isZero();
    assertThat(res.status()).isEqualTo("FAILED");
  }
}
