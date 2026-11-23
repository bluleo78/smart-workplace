package com.workplace.global.realtime;

import static com.workplace.jooq.Tables.STREAMING_GENERATION;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.catchThrowable;

import com.workplace.global.exception.StreamingGenerationRejectedException;
import com.workplace.global.exception.StreamingGenerationRejectedException.Reason;
import com.workplace.global.realtime.StreamingGenerationRegistry.ActiveGeneration;
import com.workplace.global.realtime.StreamingGenerationRegistry.GenerationTag;
import com.workplace.support.IntegrationTestBase;
import com.zaxxer.hikari.HikariDataSource;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.SQLException;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.ThreadLocalRandom;
import javax.sql.DataSource;
import org.jooq.DSLContext;
import org.jooq.SQLDialect;
import org.jooq.impl.DSL;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * {@link JooqGenerationSlotStore} 통합 검증 — 슬롯 판정(BUSY/LIMIT)·만료 정리·별도 트랜잭션 커밋·동시 예약 직렬화.
 * REQUIRES_NEW 로 커밋되는 구현이라 테스트 자체는 트랜잭션을 걸지 않고, 끝에서 파드 단위로 정리한다.
 */
class JooqGenerationSlotStoreTest extends IntegrationTestBase {

  @Autowired JooqGenerationSlotStore store;
  @Autowired DSLContext dsl;
  @Autowired PlatformTransactionManager txManager;
  @Autowired DataSource dataSource;

  /** 풀 밖 별도 접속을 열 접속 정보 — 테스트 DataSource 는 Hikari 다. */
  private HikariDataSource hikari() {
    try {
      return dataSource.unwrap(HikariDataSource.class);
    } catch (SQLException e) {
      throw new IllegalStateException(e);
    }
  }

  /** 테스트 간 충돌을 피하는 큰 랜덤 owner. */
  private final long owner = 1_000_000_000L + ThreadLocalRandom.current().nextLong(1_000_000_000L);

  private final String pod = "test-pod-" + UUID.randomUUID();

  private Instant soon() {
    return Instant.now().plus(Duration.ofHours(1));
  }

  private String reserve(long o, GenerationTag tag, int limit) {
    String id = UUID.randomUUID().toString();
    store.reserve(o, tag, limit, id, pod, soon());
    return id;
  }

  private Reason reasonOf(Throwable t) {
    assertThat(t).isInstanceOf(StreamingGenerationRejectedException.class);
    return ((StreamingGenerationRejectedException) t).reason();
  }

  @AfterEach
  void cleanup() {
    store.removeByPod(pod, List.of());
  }

  @Test
  void reserve_sameScopeAndKey_busy() {
    reserve(owner, new GenerationTag("home", "s1"), 5);
    Throwable t = catchThrowable(() -> reserve(owner, new GenerationTag("home", "s1"), 5));
    assertThat(reasonOf(t)).isEqualTo(Reason.BUSY);
  }

  @Test
  void reserve_overLimit_limit() {
    reserve(owner, new GenerationTag("home", "s1"), 2);
    reserve(owner, new GenerationTag("home", "s2"), 2);
    Throwable t = catchThrowable(() -> reserve(owner, new GenerationTag("home", "s3"), 2));
    assertThat(reasonOf(t)).isEqualTo(Reason.LIMIT);
    reserve(owner, new GenerationTag("wiki", "s3"), 2);
  }

  @Test
  void registerUntagged_notCountedNorChecked() {
    store.registerUntagged(owner, UUID.randomUUID().toString(), pod, soon());
    store.registerUntagged(owner, UUID.randomUUID().toString(), pod, soon());
    store.registerUntagged(owner, UUID.randomUUID().toString(), pod, soon());
    reserve(owner, new GenerationTag("home", "s1"), 1);
  }

  @Test
  void reserve_requestedIdTakenByOtherOwner_busy() {
    String id = "X-" + UUID.randomUUID();
    store.reserve(owner, new GenerationTag("home", "a"), 5, id, pod, soon());
    Throwable t =
        catchThrowable(
            () -> store.reserve(owner + 1, new GenerationTag("home", "b"), 5, id, pod, soon()));
    assertThat(reasonOf(t)).isEqualTo(Reason.BUSY);
  }

  @Test
  void active_returnsOnlyLiveRowsOfScope_inStartOrder() throws Exception {
    reserve(owner, new GenerationTag("home", "s1"), 5);
    Thread.sleep(20);
    reserve(owner, new GenerationTag("home", "s2"), 5);
    reserve(owner, new GenerationTag("wiki", "w1"), 5);
    List<ActiveGeneration> active = store.active(owner, "home");
    assertThat(active).extracting(ActiveGeneration::key).containsExactly("s1", "s2");
  }

  @Test
  void owner_and_remove() {
    String id = reserve(owner, new GenerationTag("home", "s1"), 5);
    // find 는 소유자와 함께 생성이 도는 파드를 돌려준다 — 취소가 낡은 행·중계 대상을 가르는 근거.
    assertThat(store.find(id)).hasValue(new GenerationSlot(owner, pod));
    assertThat(store.find(id).map(GenerationSlot::ownerUserId)).hasValue(owner);
    store.remove(id);
    assertThat(store.find(id)).isEmpty();
    store.remove(id);
  }

  @Test
  void expiredRows_areIgnoredAndPurgedOnReserve() {
    String expired = UUID.randomUUID().toString();
    store.reserve(
        owner,
        new GenerationTag("home", "s1"),
        1,
        expired,
        pod,
        Instant.now().minus(Duration.ofSeconds(1)));
    assertThat(store.active(owner, "home")).isEmpty();
    assertThat(store.find(expired)).isEmpty();
    reserve(owner, new GenerationTag("home", "s2"), 1);
    assertThat(
            dsl.fetchCount(STREAMING_GENERATION, STREAMING_GENERATION.CORRELATION_ID.eq(expired)))
        .isZero();
  }

  @Test
  void extend_movesExpiry() throws Exception {
    String id = UUID.randomUUID().toString();
    store.reserve(
        owner,
        new GenerationTag("home", "s1"),
        5,
        id,
        pod,
        Instant.now().plus(Duration.ofSeconds(3)));
    store.extend(id, Instant.now().plus(Duration.ofHours(1)));
    // 처음 만료(3초)를 넉넉히 지난 뒤에도 살아 있어야 한다 — CI 지연 여유를 둔다.
    Thread.sleep(4000);
    assertThat(store.find(id).map(GenerationSlot::ownerUserId)).hasValue(owner);
  }

  @Test
  void removeByPod_deletesOnlyThatPod() {
    String mine = reserve(owner, new GenerationTag("home", "s1"), 5);
    String otherPod = "other-pod-" + UUID.randomUUID();
    String other = UUID.randomUUID().toString();
    store.reserve(owner, new GenerationTag("home", "s2"), 5, other, otherPod, soon());
    try {
      store.removeByPod(pod, List.of());
      assertThat(store.find(mine)).isEmpty();
      assertThat(store.find(other).map(GenerationSlot::ownerUserId)).hasValue(owner);
    } finally {
      store.removeByPod(otherPod, List.of());
    }
  }

  @Test
  void reserve_insideReadOnlyTransaction_commitsSeparately() {
    TransactionTemplate outer = new TransactionTemplate(txManager);
    outer.setReadOnly(true);
    String id = UUID.randomUUID().toString();
    outer.executeWithoutResult(
        status -> {
          store.reserve(owner, new GenerationTag("home", "s1"), 5, id, pod, soon());
          status.setRollbackOnly();
        });
    assertThat(store.find(id).map(GenerationSlot::ownerUserId)).hasValue(owner);
  }

  @Test
  void concurrentReserve_atLimit_onlyOneWins() throws Exception {
    CountDownLatch ready = new CountDownLatch(2);
    CountDownLatch go = new CountDownLatch(1);
    ExecutorService pool = Executors.newFixedThreadPool(2);
    try {
      List<Future<Reason>> futures = new ArrayList<>();
      for (String key : List.of("k1", "k2")) {
        Callable<Reason> job =
            () -> {
              ready.countDown();
              go.await();
              try {
                store.reserve(
                    owner,
                    new GenerationTag("home", key),
                    1,
                    UUID.randomUUID().toString(),
                    pod,
                    soon());
                return null;
              } catch (StreamingGenerationRejectedException e) {
                return e.reason();
              }
            };
        futures.add(pool.submit(job));
      }
      ready.await();
      go.countDown();
      List<Reason> results = new ArrayList<>();
      for (Future<Reason> f : futures) results.add(f.get());
      assertThat(results.stream().filter(r -> r == null).count()).isEqualTo(1);
      assertThat(results.stream().filter(r -> r == Reason.LIMIT).count()).isEqualTo(1);
    } finally {
      pool.shutdownNow();
    }
  }

  /** 종료 정리는 keepIds(아직 도는 생성)의 행을 남기고 나머지 자기 파드 행만 지운다. */
  @Test
  void removeByPod_keepsListedIds() {
    String running = reserve(owner, new GenerationTag("home", "s1"), 5);
    String stale = reserve(owner, new GenerationTag("home", "s2"), 5);
    store.removeByPod(pod, List.of(running));
    assertThat(store.find(running)).isPresent();
    assertThat(store.find(stale)).isEmpty();
  }

  /** 다른 소유자가 같은 id 를 먼저 커밋해 둔 상태에서 예약하면 BUSY 이고, 먼저 커밋한 쪽의 행은 그대로다. */
  @Test
  void reserve_liveRowSameIdOfOtherOwner_busy() {
    String id = "race-" + UUID.randomUUID();
    insertConflictingRow(id);
    Throwable t =
        catchThrowable(
            () -> store.reserve(owner, new GenerationTag("home", "s1"), 5, id, pod, soon()));
    assertThat(reasonOf(t)).isEqualTo(Reason.BUSY);
    assertThat(store.find(id).map(GenerationSlot::ownerUserId)).hasValue(owner + 1);
  }

  /** 살아 있는 같은 id 가 있으면 태그 없는 등록도 BUSY 다. */
  @Test
  void registerUntagged_liveSameId_busy() {
    String id = "dup-" + UUID.randomUUID();
    store.registerUntagged(owner, id, pod, soon());
    Throwable t = catchThrowable(() -> store.registerUntagged(owner + 1, id, pod, soon()));
    assertThat(reasonOf(t)).isEqualTo(Reason.BUSY);
    assertThat(store.find(id).map(GenerationSlot::ownerUserId)).hasValue(owner);
  }

  /** 다른 소유자가 같은 id 를 먼저 커밋한 상황 — 테스트 풀(2)은 이미 쓰는 중이라 풀 밖의 별도 접속(autocommit)으로 넣는다. */
  private void insertConflictingRow(String id) {
    try (Connection c =
        DriverManager.getConnection(
            hikari().getJdbcUrl(), hikari().getUsername(), hikari().getPassword())) {
      DSL.using(c, SQLDialect.POSTGRES)
          .insertInto(STREAMING_GENERATION)
          .set(STREAMING_GENERATION.CORRELATION_ID, id)
          .set(STREAMING_GENERATION.OWNER_USER_ID, owner + 1)
          .set(STREAMING_GENERATION.POD_ID, pod)
          .set(STREAMING_GENERATION.EXPIRES_AT, soon().atOffset(ZoneOffset.UTC))
          .execute();
    } catch (SQLException e) {
      throw new IllegalStateException(e);
    }
  }
}
