package com.workplace.user.service;

import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.USER_ROLE;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.global.tenant.TenantContext;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.PostgresTestContainer;
import com.workplace.support.TestFixtures;
import com.workplace.tenant.repository.MembershipRepository;
import com.workplace.user.repository.UserRepository;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * WP-420 ③ — 마지막 활성 ADMIN 판정의 동시성 회귀 가드. 활성 ADMIN 이 X·Y 둘뿐인 워크스페이스에서 "X 가 Y 정지"와 "Y 가 X 정지"가 서로 다른
 * 트랜잭션에서 겹치면, READ COMMITTED 에선 둘 다 "활성 ADMIN 2명"을 보고 통과해 활성 ADMIN 이 0명이 됐다(write skew). 테넌트 관리자 판정
 * 잠금(pg_advisory_xact_lock)으로 직렬화되면 뒤 트랜잭션은 앞 트랜잭션의 커밋을 보고 거부돼야 한다.
 *
 * <p>잠금은 커밋 경계에서만 의미가 있어 @Transactional 롤백 테스트로는 볼 수 없다 — 실제 커밋하고, 만든 테넌트·사용자·역할은 @AfterEach 에서 소유자
 * 커넥션으로 직접 지운다(런타임 롤은 tenant 행을 지울 수 없다, V46).
 */
class LastAdminConcurrencyTest extends IntegrationTestBase {

  @Autowired private UserService userService;
  @Autowired private UserRepository userRepository;
  @Autowired private MembershipRepository membershipRepository;
  @Autowired private DSLContext dsl;

  private long tenantId;
  private final List<Long> userIds = new ArrayList<>();

  /**
   * 두 트랜잭션 전용 2-스레드 풀. 공용 ForkJoinPool 은 CPU 가 적은 환경에서 스레드가 1개일 수 있어 두 작업이 순차 실행되면 겹침 자체가 생기지
   * 않는다(잠금이 없어도 통과하는 거짓 GREEN). 전용 풀로 실제 동시 실행을 보장한다.
   */
  private final ExecutorService executor = Executors.newFixedThreadPool(2);

  @BeforeEach
  void setUp() {
    tenantId = TestFixtures.createTenant(dsl, "ACTIVE");
  }

  /** 소유자 커넥션으로 이 테스트가 만든 행만 지운다(RLS 우회). membership 은 user/tenant FK CASCADE 로 함께 지워진다. */
  @AfterEach
  void cleanup() throws Exception {
    // 회귀로 한쪽이 멈춰도 정리가 막히지 않게 인터럽트 후 제한 시간만 기다린다.
    executor.shutdownNow();
    executor.awaitTermination(10, TimeUnit.SECONDS);
    TenantContext.clear();
    var c = PostgresTestContainer.INSTANCE;
    try (Connection conn =
        DriverManager.getConnection(c.getJdbcUrl(), c.getUsername(), c.getPassword())) {
      try (PreparedStatement ps =
          conn.prepareStatement("DELETE FROM user_role WHERE tenant_id = ?")) {
        ps.setLong(1, tenantId);
        ps.executeUpdate();
      }
      try (PreparedStatement ps = conn.prepareStatement("DELETE FROM role WHERE tenant_id = ?")) {
        ps.setLong(1, tenantId);
        ps.executeUpdate();
      }
      try (PreparedStatement ps = conn.prepareStatement("DELETE FROM \"user\" WHERE id = ANY(?)")) {
        ps.setArray(1, conn.createArrayOf("bigint", userIds.toArray(Long[]::new)));
        ps.executeUpdate();
      }
      try (PreparedStatement ps = conn.prepareStatement("DELETE FROM tenant WHERE id = ?")) {
        ps.setLong(1, tenantId);
        ps.executeUpdate();
      }
    }
  }

  /**
   * 새 테넌트에 ADMIN 역할과 활성 ADMIN 두 명(X, Y)을 커밋해 둔다. role/user_role 은 RLS 대상이라 그 테넌트 GUC 트랜잭션 안에서 넣는다.
   */
  private long[] seedTwoActiveAdmins() {
    TenantContext.set(tenantId);
    try {
      return new TransactionTemplate(txManager)
          .execute(
              status -> {
                long adminRole =
                    dsl.insertInto(ROLE)
                        .set(ROLE.NAME, "ADMIN")
                        .set(ROLE.IS_SYSTEM, true)
                        .returning(ROLE.ID)
                        .fetchOne()
                        .getId();
                long[] ids = new long[2];
                for (int i = 0; i < 2; i++) {
                  long id = TestFixtures.createHuman(dsl);
                  userIds.add(id);
                  membershipRepository.create(id, tenantId, "ACTIVE");
                  dsl.insertInto(USER_ROLE)
                      .set(USER_ROLE.USER_ID, id)
                      .set(USER_ROLE.ROLE_ID, adminRole)
                      .execute();
                  ids[i] = id;
                }
                return ids;
              });
    } finally {
      TenantContext.clear();
    }
  }

  @Test
  void concurrentCrossSuspension_onlyOneSucceeds_andAtLeastOneActiveAdminRemains()
      throws Exception {
    long[] admins = seedTwoActiveAdmins();
    long x = admins[0];
    long y = admins[1];

    CountDownLatch firstSuspended = new CountDownLatch(1); // 첫 트랜잭션이 판정+쓰기를 마치고 아직 커밋 전
    CountDownLatch secondFinished = new CountDownLatch(1); // 두 번째 시도가 끝남(성공/실패)
    AtomicReference<Throwable> firstError = new AtomicReference<>();
    AtomicReference<Throwable> secondError = new AtomicReference<>();

    // 첫 트랜잭션: Y 정지를 실행하고 커밋을 미룬 채 두 번째 시도를 겹치게 한다. 잠금이 없으면 두 번째는 막히지 않고 곧바로
    // (커밋 전이라 여전히 2명으로 보이는 상태에서) 통과한다. 잠금이 있으면 두 번째는 이 커밋까지 막히므로 대기 시간만큼 기다렸다 커밋한다.
    CompletableFuture<Void> first =
        CompletableFuture.runAsync(
            () -> {
              TenantContext.set(tenantId);
              try {
                new TransactionTemplate(txManager)
                    .executeWithoutResult(
                        status -> {
                          userService.setUserActive(y, false);
                          firstSuspended.countDown();
                          try {
                            secondFinished.await(1, TimeUnit.SECONDS);
                          } catch (InterruptedException e) {
                            Thread.currentThread().interrupt();
                          }
                        });
              } catch (Throwable t) {
                firstError.set(t);
              } finally {
                firstSuspended.countDown();
                TenantContext.clear();
              }
            },
            executor);

    // 두 번째 트랜잭션: X 정지 — 첫 트랜잭션이 Y 를 정지한(미커밋) 직후에 시작한다.
    CompletableFuture<Void> second =
        CompletableFuture.runAsync(
            () -> {
              TenantContext.set(tenantId);
              try {
                firstSuspended.await(10, TimeUnit.SECONDS);
                userService.setUserActive(x, false);
              } catch (Throwable t) {
                secondError.set(t);
              } finally {
                secondFinished.countDown();
                TenantContext.clear();
              }
            },
            executor);

    CompletableFuture.allOf(first, second).get(30, TimeUnit.SECONDS);

    // 정확히 하나만 성공 — 앞선 Y 정지는 성공, 뒤의 X 정지는 마지막 활성 ADMIN 이라 거부.
    assertThat(firstError.get()).isNull();
    assertThat(secondError.get())
        .isInstanceOf(IllegalStateException.class)
        .hasMessageContaining("마지막 활성 ADMIN");
    assertThat(TestFixtures.membershipStatus(dsl, y, tenantId)).isEqualTo("SUSPENDED");
    assertThat(TestFixtures.membershipStatus(dsl, x, tenantId)).isEqualTo("ACTIVE");
    assertThat(activeAdminCount()).isGreaterThanOrEqualTo(1);
  }

  /** 커밋된 상태 기준 이 테넌트의 활성 ADMIN 수(서비스와 같은 술어). */
  private int activeAdminCount() {
    TenantContext.set(tenantId);
    try {
      return new TransactionTemplate(txManager)
          .execute(status -> userRepository.countActiveAdmins(tenantId));
    } finally {
      TenantContext.clear();
    }
  }
}
