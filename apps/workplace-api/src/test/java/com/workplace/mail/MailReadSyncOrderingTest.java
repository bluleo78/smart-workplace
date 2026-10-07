package com.workplace.mail;

import static com.workplace.jooq.Tables.EMAIL_ACCOUNT;
import static com.workplace.jooq.Tables.EMAIL_MESSAGE;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.awaitility.Awaitility.await;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.reset;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import com.workplace.global.tenant.TenantContext;
import com.workplace.jooq.tables.records.EmailMessageRecord;
import com.workplace.mail.outbound.GraphApiClient;
import com.workplace.mail.outbound.GraphBatchRequest;
import com.workplace.mail.outbound.GraphBatchResponse;
import com.workplace.mail.repository.EmailAccountRepository;
import com.workplace.mail.repository.EmailMessageRepository;
import com.workplace.mail.repository.EmailMessageRepository.DueSeenPushAccount;
import com.workplace.mail.service.GraphTokenService;
import com.workplace.mail.service.MailMessageService;
import com.workplace.mail.service.MailReadSyncDispatcher;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.time.Duration;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.CyclicBarrier;
import java.util.concurrent.Executor;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.core.task.TaskRejectedException;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * WP-188 읽음 역동기화 순서 보장·재시도 통합 테스트.
 *
 * <ul>
 *   <li>순서 역전 경합: 옛 값(true) 반영이 걸려 있는 동안 사용자가 안읽음으로 바꿔도, 서버 최종값 = 사용자의 마지막 값(false).
 *   <li>계정 리스: 두 "인스턴스"(동시 스레드)가 같은 계정 리스를 동시에 쥐지 못한다. 만료된 리스는 다른 실행이 가져간다(크래시 복구).
 *   <li>재시도: 실패 → 백오프 동안 재시도 안 함 → 시각이 지나면 재반영. 상한 도달 시 포기(대기 해제). 큐 포화로 거절된 건 회수.
 * </ul>
 *
 * <p><b>@Transactional 금지</b>: 리스·해제가 각자 짧은 트랜잭션으로 커밋돼야 하고 AFTER_COMMIT 리스너가 발화해야 한다.
 * 시드는 @AfterEach 에서 계정 CASCADE 로 지운다. 공유 test DB 이므로 단언은 이 테스트가 시드한 계정·메일로 한정한다. 재시도 배치 전체
 * 순회({@code retryAllTenants})는 다른 테스트 클래스의 시드까지 건드리므로 부르지 않고, 배치가 쓰는 계정 조회와 계정 단위 디스패치를 각각 검증한다.
 */
class MailReadSyncOrderingTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired MailMessageService messageService;
  @Autowired MailReadSyncDispatcher dispatcher;
  @Autowired EmailAccountRepository accountRepo;
  @Autowired EmailMessageRepository messageRepo;
  @Autowired PlatformTransactionManager txManager;

  @Autowired
  @Qualifier("mailReadSyncExecutor")
  Executor mailReadSyncExecutor;

  /** Graph HTTP 차단 — 테스트마다 "서버" 동작을 스텁한다. */
  @MockitoBean GraphApiClient graphApiClient;

  @MockitoBean GraphTokenService graphTokenService;

  private Long seededUser;
  private Long seededAccount;

  @AfterEach
  void cleanup() {
    if (seededAccount != null) {
      cleanupInTenant(
          1L,
          () -> dsl.deleteFrom(EMAIL_ACCOUNT).where(EMAIL_ACCOUNT.ID.eq(seededAccount)).execute());
    }
    if (seededUser != null) {
      cleanupInTenant(1L, () -> dsl.deleteFrom(USER).where(USER.ID.eq(seededUser)).execute());
    }
    TenantContext.clear();
  }

  /** tenant 1 에 사용자·Graph 계정·안 읽은 메일 하나를 커밋하고 메일 id 를 돌려준다. 토큰 조회는 FAKE_TOKEN. */
  private long seed(String providerMessageId) {
    dsl.execute("SELECT set_config('app.tenant_id', '1', false)");
    seededUser = TestFixtures.createHuman(dsl);
    seededAccount = MailTestSupport.seedGraphAccount(dsl, seededUser);
    long id = MailTestSupport.seedUnseenGraphMessage(dsl, seededAccount, providerMessageId);
    when(graphTokenService.getAccessToken(seededUser, seededAccount)).thenReturn("FAKE_TOKEN");
    TenantContext.set(1L);
    return id;
  }

  /** 메일 행 조회(RLS — tenant 1 트랜잭션). */
  private EmailMessageRecord row(long messageId) {
    return inTx(
        () -> dsl.selectFrom(EMAIL_MESSAGE).where(EMAIL_MESSAGE.ID.eq(messageId)).fetchOne());
  }

  private <T> T inTx(java.util.function.Supplier<T> body) {
    TenantContext.set(1L);
    return new TransactionTemplate(txManager).execute(s -> body.get());
  }

  /** 테스트용 직접 갱신(RLS — tenant 1 트랜잭션). */
  private void update(Runnable r) {
    cleanupInTenant(1L, r);
  }

  /** 모든 요청에 200 을 돌려주며 "서버" 상태(provider id → isRead)를 요청 순서대로 덮어쓰는 응답. */
  private List<GraphBatchResponse> applyToServer(
      Map<String, Boolean> server, List<GraphBatchRequest> reqs) {
    List<GraphBatchResponse> out = new ArrayList<>();
    for (GraphBatchRequest rq : reqs) {
      server.put(rq.url(), (Boolean) rq.body().get("isRead"));
      out.add(new GraphBatchResponse(rq.id(), 200));
    }
    return out;
  }

  /**
   * 순서 역전 경합 — 옛 값(true) 반영이 원격 호출 안에서 걸려 있는 동안 사용자가 안읽음으로 바꾸고, 다른 "인스턴스"가 같은 계정을 반영하려 해도 리스에 막혀 원격
   * 호출을 하지 못한다. 걸린 반영이 끝나면 같은 리스 보유 안에서 새 값(false)을 다시 보내 서버 최종값 = 사용자의 마지막 값이 되고 대기가 풀린다. 원격 호출이
   * 동시에 둘 이상 겹친 적이 없어야 한다.
   */
  @Test
  void staleValueArrivingLate_neverBecomesFinal_serverEndsWithLastUserValue() throws Exception {
    long id = seed("AAORDER");
    String url = "/me/messages/AAORDER";
    Map<String, Boolean> server = new ConcurrentHashMap<>();
    AtomicInteger calls = new AtomicInteger();
    AtomicInteger active = new AtomicInteger();
    AtomicInteger maxActive = new AtomicInteger();
    CountDownLatch inFlight = new CountDownLatch(1);
    CountDownLatch proceed = new CountDownLatch(1);
    when(graphApiClient.batch(eq("FAKE_TOKEN"), anyList()))
        .thenAnswer(
            inv -> {
              int now = active.incrementAndGet();
              maxActive.accumulateAndGet(now, Math::max);
              try {
                if (calls.incrementAndGet() == 1) {
                  inFlight.countDown();
                  proceed.await(10, TimeUnit.SECONDS); // 첫 반영(true)을 원격 호출 안에서 붙잡는다
                }
                return applyToServer(server, inv.getArgument(1));
              } finally {
                active.decrementAndGet();
              }
            });

    messageService.markRead(seededUser, id); // seen=true → 리스너 A 가 리스를 잡고 true 를 보내다 걸림
    assertThat(inFlight.await(5, TimeUnit.SECONDS)).isTrue();

    TenantContext.set(1L);
    messageService.markUnread(seededUser, id); // 사용자가 되돌림 — 리스너 B 는 리스에 막힌다
    // 두 번째 "인스턴스"가 동기 호출로 같은 계정을 반영하려 해도 리스에 막혀 원격 호출이 없다
    dispatcher.dispatchAccount(seededUser, seededAccount);
    assertThat(calls.get()).isEqualTo(1);

    proceed.countDown(); // 옛 값 true 가 이제야 서버에 닿는다

    await()
        .atMost(Duration.ofSeconds(10))
        .until(() -> !row(id).getSeenPushPending() && Boolean.FALSE.equals(server.get(url)));
    ThreadPoolTaskExecutor exec = (ThreadPoolTaskExecutor) mailReadSyncExecutor;
    await().atMost(Duration.ofSeconds(5)).until(() -> exec.getActiveCount() == 0);

    assertThat(server.get(url)).as("서버 최종값 = 사용자의 마지막 값").isFalse();
    assertThat(row(id).getSeen()).isFalse();
    assertThat(row(id).getSeenPushPending()).isFalse();
    assertThat(maxActive.get()).as("한 계정의 원격 반영은 동시에 하나뿐").isEqualTo(1);
  }

  /** 두 "인스턴스"가 동시에 같은 계정 리스를 시도해도 하나만 얻는다. 해제 뒤에는 다른 쪽이 얻는다. */
  @Test
  void lease_concurrentAcquire_onlyOneWins() throws Exception {
    seed("AALEASE");
    CyclicBarrier barrier = new CyclicBarrier(2);
    ExecutorService pool = Executors.newFixedThreadPool(2);
    try {
      List<Future<Boolean>> results = new ArrayList<>();
      for (String owner : List.of("inst-A", "inst-B")) {
        results.add(
            pool.submit(
                () -> {
                  barrier.await(5, TimeUnit.SECONDS);
                  return inTx(
                      () ->
                          accountRepo.tryAcquireSeenPushLease(
                              seededAccount, owner, Duration.ofMinutes(5)));
                }));
      }
      int wins = 0;
      for (Future<Boolean> f : results) {
        wins += f.get(10, TimeUnit.SECONDS) ? 1 : 0;
      }
      assertThat(wins).isEqualTo(1);
    } finally {
      pool.shutdownNow();
      TenantContext.clear();
    }

    String holder =
        inTx(
            () ->
                dsl.select(EMAIL_ACCOUNT.SEEN_PUSH_LEASE_OWNER)
                    .from(EMAIL_ACCOUNT)
                    .where(EMAIL_ACCOUNT.ID.eq(seededAccount))
                    .fetchOne(EMAIL_ACCOUNT.SEEN_PUSH_LEASE_OWNER));
    String other = holder.equals("inst-A") ? "inst-B" : "inst-A";
    // 보유자가 아닌 쪽은 연장·해제를 못 한다
    assertThat(
            inTx(() -> accountRepo.renewSeenPushLease(seededAccount, other, Duration.ofMinutes(5))))
        .isFalse();
    update(() -> accountRepo.releaseSeenPushLease(seededAccount, other));
    assertThat(
            inTx(
                () ->
                    accountRepo.tryAcquireSeenPushLease(
                        seededAccount, other, Duration.ofMinutes(5))))
        .isFalse();
    // 보유자가 놓으면 다른 쪽이 얻는다
    update(() -> accountRepo.releaseSeenPushLease(seededAccount, holder));
    assertThat(
            inTx(
                () ->
                    accountRepo.tryAcquireSeenPushLease(
                        seededAccount, other, Duration.ofMinutes(5))))
        .isTrue();
  }

  /** 살아 있는 남의 리스가 있으면 반영하지 않고 대기를 남긴다. 그 리스가 만료되면(보유자 크래시) 다음 실행이 가져가 반영한다. */
  @Test
  void lease_heldByOther_skips_thenExpired_isTakenOver() {
    long id = seed("AAEXPIRE");
    Map<String, Boolean> server = new ConcurrentHashMap<>();
    when(graphApiClient.batch(eq("FAKE_TOKEN"), anyList()))
        .thenAnswer(inv -> applyToServer(server, inv.getArgument(1)));
    update(() -> messageRepo.markSeen(id));
    // 다른 인스턴스가 쥔 채 죽은 리스 — 아직 유효
    update(
        () ->
            dsl.update(EMAIL_ACCOUNT)
                .set(EMAIL_ACCOUNT.SEEN_PUSH_LEASE_OWNER, "dead-instance")
                .set(EMAIL_ACCOUNT.SEEN_PUSH_LEASE_UNTIL, OffsetDateTime.now().plusMinutes(5))
                .where(EMAIL_ACCOUNT.ID.eq(seededAccount))
                .execute());

    dispatcher.dispatchAccount(seededUser, seededAccount);
    verifyNoInteractions(graphApiClient);
    assertThat(row(id).getSeenPushPending()).isTrue();
    assertThat(row(id).getSeenPushAttempts()).as("리스 대기는 실패로 세지 않는다").isZero();

    // 만료 — 크래시 복구
    update(
        () ->
            dsl.update(EMAIL_ACCOUNT)
                .set(EMAIL_ACCOUNT.SEEN_PUSH_LEASE_UNTIL, OffsetDateTime.now().minusMinutes(1))
                .where(EMAIL_ACCOUNT.ID.eq(seededAccount))
                .execute());
    dispatcher.dispatchAccount(seededUser, seededAccount);

    assertThat(server.get("/me/messages/AAEXPIRE")).isTrue();
    assertThat(row(id).getSeenPushPending()).isFalse();
    String owner =
        inTx(
            () ->
                dsl.select(EMAIL_ACCOUNT.SEEN_PUSH_LEASE_OWNER)
                    .from(EMAIL_ACCOUNT)
                    .where(EMAIL_ACCOUNT.ID.eq(seededAccount))
                    .fetchOne(EMAIL_ACCOUNT.SEEN_PUSH_LEASE_OWNER));
    assertThat(owner).as("끝나면 리스를 놓는다").isNull();
  }

  /** 실패하면 횟수 +1·백오프로 미루고, 백오프 동안은 다시 보내지 않으며, 시각이 지나면 재반영해 대기를 푼다. 배치 계정 조회도 같은 기준을 따른다. */
  @Test
  void retry_failureBacksOff_thenRetriedWhenDue() {
    long id = seed("AARETRY");
    update(() -> messageRepo.markSeen(id));
    doThrow(new RuntimeException("boom")).when(graphApiClient).batch(any(), anyList());

    dispatcher.dispatchAccount(seededUser, seededAccount);

    EmailMessageRecord failed = row(id);
    assertThat(failed.getSeenPushPending()).isTrue();
    assertThat(failed.getSeenPushAttempts()).isEqualTo(1);
    assertThat(failed.getSeenPushNextAt()).isAfter(OffsetDateTime.now());
    // 백오프 중 — 배치 대상 아님, 다시 불러도 원격 호출 없음
    assertThat(inTx(() -> messageRepo.findAccountsWithDueSeenPush()))
        .extracting(DueSeenPushAccount::accountId)
        .doesNotContain(seededAccount);
    dispatcher.dispatchAccount(seededUser, seededAccount);
    verify(graphApiClient, times(1)).batch(any(), anyList());

    // 백오프 시각 경과 + 서버 회복
    update(
        () ->
            dsl.update(EMAIL_MESSAGE)
                .set(EMAIL_MESSAGE.SEEN_PUSH_NEXT_AT, OffsetDateTime.now().minusSeconds(1))
                .where(EMAIL_MESSAGE.ID.eq(id))
                .execute());
    assertThat(inTx(() -> messageRepo.findAccountsWithDueSeenPush()))
        .contains(new DueSeenPushAccount(seededAccount, seededUser));
    reset(graphApiClient);
    Map<String, Boolean> server = new ConcurrentHashMap<>();
    when(graphApiClient.batch(eq("FAKE_TOKEN"), anyList()))
        .thenAnswer(inv -> applyToServer(server, inv.getArgument(1)));

    dispatcher.dispatchAccount(seededUser, seededAccount);

    assertThat(server.get("/me/messages/AARETRY")).isTrue();
    EmailMessageRecord done = row(id);
    assertThat(done.getSeenPushPending()).isFalse();
    assertThat(done.getSeenPushAttempts()).isZero();
    assertThat(done.getSeenPushNextAt()).isNull();
  }

  /** 상한에 닿는 실패면 포기한다 — 대기를 풀어 다음 동기화가 서버 값을 따른다(로컬 seen 은 그대로). */
  @Test
  void retry_capReached_givesUpAndClearsPending() {
    long id = seed("AAGIVEUP");
    update(() -> messageRepo.markSeen(id));
    update(
        () ->
            dsl.update(EMAIL_MESSAGE)
                .set(EMAIL_MESSAGE.SEEN_PUSH_ATTEMPTS, 7) // MAX_ATTEMPTS(8) - 1
                .where(EMAIL_MESSAGE.ID.eq(id))
                .execute());
    doThrow(new RuntimeException("boom")).when(graphApiClient).batch(any(), anyList());

    dispatcher.dispatchAccount(seededUser, seededAccount);

    EmailMessageRecord r = row(id);
    assertThat(r.getSeenPushPending()).isFalse();
    assertThat(r.getSeenPushAttempts()).isZero();
    assertThat(r.getSeen()).isTrue();
  }

  /** 사용자가 다시 바꾸면 지난 실패의 백오프·횟수를 잊고 바로 반영 대상이 된다. */
  @Test
  void userChange_resetsBackoff() {
    long id = seed("AARESET");
    update(() -> messageRepo.markSeen(id));
    doThrow(new RuntimeException("boom")).when(graphApiClient).batch(any(), anyList());
    dispatcher.dispatchAccount(seededUser, seededAccount);
    assertThat(row(id).getSeenPushAttempts()).isEqualTo(1);

    update(() -> messageRepo.markUnseen(id));

    EmailMessageRecord r = row(id);
    assertThat(r.getSeenPushAttempts()).isZero();
    assertThat(r.getSeenPushNextAt()).isBeforeOrEqualTo(OffsetDateTime.now().plusSeconds(1));
    assertThat(inTx(() -> messageRepo.findAccountsWithDueSeenPush()))
        .contains(new DueSeenPushAccount(seededAccount, seededUser));
  }

  /** 역동기화 큐가 차서 이벤트가 거절된 건은 반영 대기(즉시 대상)로 남고, 재시도 배치 경로(계정 조회 → 계정 디스패치)가 회수한다. */
  @Test
  void executorRejected_isRecoveredByRetryPath() {
    long id = seed("AAREJECT");
    Map<String, Boolean> server = new ConcurrentHashMap<>();
    when(graphApiClient.batch(eq("FAKE_TOKEN"), anyList()))
        .thenAnswer(inv -> applyToServer(server, inv.getArgument(1)));

    CountDownLatch release = new CountDownLatch(1);
    try {
      boolean saturated = false;
      for (int i = 0; i < 1_000 && !saturated; i++) {
        try {
          mailReadSyncExecutor.execute(
              () -> {
                try {
                  release.await();
                } catch (InterruptedException e) {
                  Thread.currentThread().interrupt();
                }
              });
        } catch (TaskRejectedException e) {
          saturated = true;
        }
      }
      assertThat(saturated).isTrue();
      TenantContext.set(1L);
      messageService.markRead(seededUser, id); // 이벤트 거절 — 요청은 성공
    } finally {
      release.countDown();
    }
    ThreadPoolTaskExecutor exec = (ThreadPoolTaskExecutor) mailReadSyncExecutor;
    await().atMost(Duration.ofSeconds(5)).until(() -> exec.getActiveCount() == 0);
    verifyNoInteractions(graphApiClient);
    assertThat(row(id).getSeenPushPending()).isTrue();

    // 재시도 배치가 하는 일: 대상 계정 조회 → 계정 단위 디스패치
    List<DueSeenPushAccount> due = inTx(() -> messageRepo.findAccountsWithDueSeenPush());
    assertThat(due).contains(new DueSeenPushAccount(seededAccount, seededUser));
    dispatcher.dispatchAccount(seededUser, seededAccount);

    assertThat(server.get("/me/messages/AAREJECT")).isTrue();
    assertThat(row(id).getSeenPushPending()).isFalse();
  }
}
