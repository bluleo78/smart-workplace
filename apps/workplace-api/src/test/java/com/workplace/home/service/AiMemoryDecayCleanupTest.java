package com.workplace.home.service;

import static com.workplace.jooq.Tables.AI_MEMORY;
import static com.workplace.jooq.Tables.AI_MEMORY_CHANGE;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.global.tenant.TenantContext;
import com.workplace.home.AiMemoryTestFixtures;
import com.workplace.home.repository.AiMemoryChangeRepository;
import com.workplace.home.repository.AiMemoryChangeRepository.ChangeRow;
import com.workplace.home.repository.AiMemoryRepository;
import com.workplace.home.repository.AiMemoryRepository.NewMemory;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.function.Supplier;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * WP-385 감쇠 삭제(90일)·DECAYED 기록(사용자별 run_id 하나)·30일 지난 기록 정리 — 만료 정리 배치와 같이 활성 테넌트마다 GUC 트랜잭션에서 돈다.
 * 배치가 자체 트랜잭션을 쓰므로 트랜잭션 없이 커밋하고 직접 정리한다.
 */
class AiMemoryDecayCleanupTest extends IntegrationTestBase {

  @Autowired AiMemoryRepository repo;
  @Autowired AiMemoryExpiryCleanupScheduler scheduler;
  @Autowired AiMemoryChangeRepository changeRepo;
  @Autowired AiMemoryChangeLog changeLog;

  private final List<Long> users = new ArrayList<>();

  @BeforeEach
  void setUp() {
    TenantContext.set(1L);
  }

  @AfterEach
  void tearDown() {
    cleanupInTenant(
        1L,
        () -> {
          baseDsl.deleteFrom(AI_MEMORY_CHANGE).where(AI_MEMORY_CHANGE.USER_ID.in(users)).execute();
          baseDsl.deleteFrom(AI_MEMORY).where(AI_MEMORY.USER_ID.in(users)).execute();
        });
    baseDsl.deleteFrom(USER).where(USER.ID.in(users)).execute();
    TenantContext.clear();
  }

  private <T> T inTenant(Supplier<T> work) {
    return new TransactionTemplate(txManager).execute(s -> work.get());
  }

  private long user() {
    long uid = TestFixtures.createHuman(baseDsl);
    users.add(uid);
    return uid;
  }

  /** 메모리 1건 — 사용 시각을 usedDaysAgo 일 전으로. */
  private long seed(long uid, String content, String source, boolean pinned, int usedDaysAgo) {
    long id =
        inTenant(
            () ->
                repo.insert(uid, new NewMemory("PREFERENCE", content, source, null, null, null))
                    .id());
    inTenant(
        () ->
            baseDsl
                .update(AI_MEMORY)
                .set(AI_MEMORY.PINNED, pinned)
                .set(
                    AI_MEMORY.LAST_USED_AT,
                    OffsetDateTime.now(ZoneOffset.UTC).minusDays(usedDaysAgo))
                .where(AI_MEMORY.ID.eq(id))
                .execute());
    return id;
  }

  private List<Long> ids(long uid) {
    return inTenant(
        () ->
            AiMemoryTestFixtures.allMemories(baseDsl, uid).stream()
                .map(AiMemoryRepository.Row::id)
                .toList());
  }

  @Test
  void 구십일_넘게_안_쓴_AI_메모리만_지우고_DECAYED_기록을_남긴다() {
    long a = user();
    long old1 = seed(a, "오래된 AI 1", "AI", false, 91);
    long old2 = seed(a, "오래된 AI 2", "AI", false, 120);
    long recent = seed(a, "최근 AI", "AI", false, 89);
    long userOld = seed(a, "오래된 직접 추가", "USER", false, 200);
    long pinnedOld = seed(a, "오래된 고정", "AI", true, 200);

    assertThat(scheduler.decayAllTenants()).isGreaterThanOrEqualTo(2);

    assertThat(ids(a)).containsExactlyInAnyOrder(recent, userOld, pinnedOld);
    List<ChangeRow> changes = inTenant(() -> changeRepo.page(a, null, 10));
    assertThat(changes).extracting(ChangeRow::action).containsOnly("DECAYED");
    assertThat(changes).extracting(ChangeRow::memoryId).containsExactlyInAnyOrder(old1, old2);
    assertThat(changes).allSatisfy(c -> assertThat(c.afterJson()).isNull());
    assertThat(changes)
        .extracting(c -> changeLog.readBefore(c.beforeJson()).get(0).content())
        .containsExactlyInAnyOrder("오래된 AI 1", "오래된 AI 2");
    // 같은 사용자의 한 번의 감쇠는 run_id 하나로 묶인다.
    assertThat(
            inTenant(
                () ->
                    baseDsl
                        .selectDistinct(AI_MEMORY_CHANGE.RUN_ID)
                        .from(AI_MEMORY_CHANGE)
                        .where(AI_MEMORY_CHANGE.USER_ID.eq(a))
                        .fetch()))
        .hasSize(1);
  }

  @Test
  void 삼십일_넘은_정리_기록은_지우고_그_안의_기록은_남긴다() {
    long a = user();
    OffsetDateTime now = OffsetDateTime.now(ZoneOffset.UTC);
    MemorySnapshot s =
        MemorySnapshot.of(
            inTenant(
                () -> repo.insert(a, new NewMemory("PREFERENCE", "x", "AI", null, null, null))));
    inTenant(
        () ->
            changeLog.record(
                a,
                UUID.randomUUID(),
                AiMemoryChangeAction.ADDED,
                s.id(),
                List.of(),
                s,
                null,
                "오래됨",
                now.minusDays(31)));
    inTenant(
        () ->
            changeLog.record(
                a,
                UUID.randomUUID(),
                AiMemoryChangeAction.ADDED,
                s.id(),
                List.of(),
                s,
                null,
                "최근",
                now.minusDays(29)));

    scheduler.purgeOldChangesAllTenants();

    assertThat(inTenant(() -> changeRepo.page(a, null, 10)))
        .extracting(ChangeRow::reason)
        .containsExactly("최근");
  }
}
