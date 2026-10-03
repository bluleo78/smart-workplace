package com.workplace.mail.service;

import static com.workplace.jooq.Tables.EMAIL_ACCOUNT;
import static com.workplace.jooq.Tables.TENANT;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.doAnswer;

import com.workplace.global.outbound.AgentOutageGuard;
import com.workplace.global.tenant.TenantContext;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicBoolean;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

/**
 * WP-185 분류 일괄 스케줄러 — 모든 활성 계정을 자기 테넌트 컨텍스트에서 분류하고, 회차 guard 멈춤·회차 묶음 상한·계정별 실패 격리를 지키는지 검증한다.
 *
 * <p>서비스는 mock(LLM 차단). 공유 테스트 DB 에는 다른 테스트의 활성 계정이 남아 있을 수 있고 순회 순서도 정해져 있지 않으므로, 시드한 계정에 대해서만
 * 단언하고 시드 외 계정은 0(묶음 호출 없음)을 돌려 회차 예산을 쓰지 않게 한다. 순서에 기대지 않도록 "처음 불린 시드 계정" 기준으로 동작을 건다.
 */
@DisplayName("분류 일괄 스케줄러 — 테넌트 컨텍스트·guard 중단·회차 상한·실패 격리")
class MailCategoryBackfillSchedulerIT extends IntegrationTestBase {

  private static final String TENANT2_SLUG = "mail-category-sched-tenant-2";

  @Autowired DSLContext dsl;
  @Autowired MailCategoryBackfillScheduler scheduler;

  @MockitoBean MailCategoryBackfillService categoryBackfill;

  /** 서비스가 받은 (계정, 넘겨받은 예산, 호출 시점 TenantContext). */
  private record Call(long userId, long accountId, int budget, Long ctx) {}

  private final List<Call> calls = Collections.synchronizedList(new ArrayList<>());

  /** 시드한 (tenantId, userId, accountId) — 정리용. */
  private final List<long[]> seeded = new ArrayList<>();

  /** 세션 GUC 를 대상 테넌트로 전환(autocommit 시드용). */
  private void setSessionGuc(long tenantId) {
    dsl.execute("SELECT set_config('app.tenant_id', '" + tenantId + "', false)");
  }

  /** 고정 슬러그로 두 번째 ACTIVE 테넌트를 find-or-create(app_tenant 는 tenant DELETE 불가라 누적 방지). */
  private long ensureSecondTenant() {
    Long existing =
        dsl.select(TENANT.ID).from(TENANT).where(TENANT.SLUG.eq(TENANT2_SLUG)).fetchOne(TENANT.ID);
    if (existing != null) {
      return existing;
    }
    return dsl.insertInto(TENANT)
        .set(TENANT.SLUG, TENANT2_SLUG)
        .set(TENANT.NAME, "Mail Category Sched Tenant 2")
        .set(TENANT.STATUS, "ACTIVE")
        .returning(TENANT.ID)
        .fetchOne()
        .getId();
  }

  /** 현재 세션 GUC 테넌트에 사용자 + 활성 계정 1건을 커밋 시드. accountId 반환. */
  private long seedAccount(long tenantId) {
    setSessionGuc(tenantId);
    long userId = TestFixtures.createHuman(dsl);
    long accountId =
        dsl.insertInto(EMAIL_ACCOUNT)
            .set(EMAIL_ACCOUNT.USER_ID, userId)
            .set(
                EMAIL_ACCOUNT.EMAIL_ADDRESS,
                "cat-" + UUID.randomUUID().toString().substring(0, 8) + "@test.local")
            .returning(EMAIL_ACCOUNT.ID)
            .fetchOne()
            .getId();
    seeded.add(new long[] {tenantId, userId, accountId});
    setSessionGuc(1L);
    return accountId;
  }

  private Set<Long> seededAccountIds() {
    Set<Long> ids = new HashSet<>();
    seeded.forEach(s -> ids.add(s[2]));
    return ids;
  }

  private List<Call> seededCalls() {
    Set<Long> ids = seededAccountIds();
    synchronized (calls) {
      return calls.stream().filter(c -> ids.contains(c.accountId())).toList();
    }
  }

  /**
   * 서비스 mock — 호출을 기록하고, 시드 계정이면 behavior 의 반환값(묶음 호출 수)을, 아니면 0 을 돌려준다. behavior 는 (호출, 넘겨받은
   * guard) 를 받는다.
   */
  private void stub(java.util.function.BiFunction<Call, AgentOutageGuard, Integer> behavior) {
    Set<Long> ids = seededAccountIds();
    doAnswer(
            inv -> {
              Call c =
                  new Call(
                      inv.getArgument(0),
                      inv.getArgument(1),
                      inv.getArgument(3),
                      TenantContext.get());
              calls.add(c);
              return ids.contains(c.accountId()) ? behavior.apply(c, inv.getArgument(2)) : 0;
            })
        .when(categoryBackfill)
        .classifyAccountNow(anyLong(), anyLong(), any(), anyInt());
  }

  @AfterEach
  void cleanup() {
    for (long[] s : seeded) {
      cleanupInTenant(
          s[0],
          () -> {
            dsl.deleteFrom(EMAIL_ACCOUNT).where(EMAIL_ACCOUNT.ID.eq(s[2])).execute();
            dsl.deleteFrom(USER).where(USER.ID.eq(s[1])).execute();
          });
    }
    setSessionGuc(1L);
    TenantContext.clear();
  }

  @Test
  @DisplayName("모든 활성 계정이 자기 테넌트 컨텍스트에서 한 번씩 분류된다")
  void everyActiveAccount_classifiedUnderOwnTenant() {
    long tid2 = ensureSecondTenant();
    long a1 = seedAccount(1L);
    long a2 = seedAccount(tid2);
    stub((c, g) -> 0);

    scheduler.runOnceNow();

    List<Call> mine = seededCalls();
    assertThat(mine).hasSize(2);
    assertThat(mine.stream().filter(c -> c.accountId() == a1).map(Call::ctx)).containsExactly(1L);
    assertThat(mine.stream().filter(c -> c.accountId() == a2).map(Call::ctx)).containsExactly(tid2);
    assertThat(TenantContext.get()).isNull(); // 계정마다 주입한 컨텍스트를 치운다
  }

  @Test
  @DisplayName("회차 중 ai-agent 불가로 guard 가 멈추면 그 회차의 남은 계정은 부르지 않는다")
  void guardTripped_skipsRemainingAccounts() {
    for (int i = 0; i < 3; i++) {
      seedAccount(1L);
    }
    AtomicBoolean tripped = new AtomicBoolean(false);
    stub(
        (c, guard) -> {
          // 처음 불린 시드 계정에서 회차 공용 guard 를 연속 불가로 멈춘다(실제 서비스가 하는 일과 같은 API)
          if (tripped.compareAndSet(false, true)) {
            for (int i = 0; i < AgentOutageGuard.MAX_CONSECUTIVE_UNAVAILABLE; i++) {
              guard.recordUnavailable();
            }
          }
          return 1;
        });

    scheduler.runOnceNow();

    assertThat(seededCalls()).hasSize(1);
    // 멈춘 뒤에는 시드 외 계정도 포함해 어떤 계정도 불리지 않는다 — 마지막 호출이 멈춘 그 계정이다
    assertThat(calls.get(calls.size() - 1)).isEqualTo(seededCalls().get(0));
  }

  @Test
  @DisplayName("회차 전체 묶음 호출은 상한을 넘지 않고, 예산이 바닥나면 남은 계정은 건너뛴다")
  void roundCap_limitsTotalBatches() {
    // 계정당 상한(4)만큼 매번 쓰면 5개 계정에서 20 이 바닥난다 → 6번째는 불리지 않아야 한다
    for (int i = 0; i < 6; i++) {
      seedAccount(1L);
    }
    stub((c, g) -> Math.min(c.budget(), MailCategoryBackfillService.MAX_BATCHES));

    scheduler.runOnceNow();

    List<Call> mine = seededCalls();
    assertThat(mine).hasSize(5);
    int used =
        mine.stream()
            .mapToInt(c -> Math.min(c.budget(), MailCategoryBackfillService.MAX_BATCHES))
            .sum();
    assertThat(used).isEqualTo(MailCategoryBackfillScheduler.MAX_BATCHES_PER_ROUND);
    // 넘겨받은 예산은 회차 상한에서 출발해 쓴 만큼 줄어든다 — 20, 16, 12, 8, 4
    assertThat(mine.stream().map(Call::budget)).containsExactly(20, 16, 12, 8, 4);
  }

  @Test
  @DisplayName("한 계정이 예외를 던져도 다음 계정은 계속 분류된다")
  void accountFailure_doesNotStopNext() {
    for (int i = 0; i < 3; i++) {
      seedAccount(1L);
    }
    AtomicBoolean thrown = new AtomicBoolean(false);
    stub(
        (c, g) -> {
          if (thrown.compareAndSet(false, true)) {
            throw new IllegalStateException("boom");
          }
          return 1;
        });

    scheduler.runOnceNow();

    assertThat(seededCalls()).hasSize(3);
    assertThat(TenantContext.get()).isNull();
  }

  @Test
  @DisplayName("백로그가 큰 계정이 6개 이상이어도 시작 위치가 회차마다 돌아 모든 계정에 닿는다")
  void rotatingStart_reachesEveryAccount_acrossRounds() {
    for (int i = 0; i < 6; i++) {
      seedAccount(1L);
    }
    stub((c, g) -> Math.min(c.budget(), MailCategoryBackfillService.MAX_BATCHES));

    Set<Long> reached = new HashSet<>();
    Set<Long> firstPerRound = new HashSet<>();
    // 시드 외 활성 계정(예산 0 사용)이 섞여 있어도 시작 위치가 한 칸씩 전진하므로 계정 수 회차 안에 모두 닿는다
    for (int round = 0; round < 60 && reached.size() < 6; round++) {
      calls.clear();
      scheduler.runOnceNow();
      List<Call> mine = seededCalls();
      mine.forEach(c -> reached.add(c.accountId()));
      if (!mine.isEmpty()) {
        firstPerRound.add(mine.get(0).accountId());
      }
    }

    assertThat(reached).containsExactlyInAnyOrderElementsOf(seededAccountIds());
    assertThat(firstPerRound.size()).isGreaterThan(1); // 매번 같은 계정부터 시작하지 않는다
  }
}
