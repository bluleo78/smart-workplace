package com.workplace.user;

import static com.workplace.jooq.Tables.AUDIT_LOG;
import static com.workplace.jooq.Tables.PERMISSION;
import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.ROLE_PERMISSION;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.global.tenant.TenantContext;
import com.workplace.role.service.RoleService;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.RowLockWaits;
import com.workplace.support.TestFixtures;
import com.workplace.user.service.UserService;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.function.Supplier;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * AI 역할 부여와 그 역할의 관리 권한 추가 경합(WP-770) — 「AI 에게 관리 권한 역할을 주지 못한다」(역할 부여 쪽)와 「AI 가 가진 역할에 관리 권한을 더하지
 * 못한다」(권한 변경 쪽)는 각자 상대의 커밋 전 상태를 보고 둘 다 통과해, AI 가 user:write 가 든 역할을 갖게 됐다(WP-728 가드 우회).
 *
 * <p>순서를 결정적으로 맞춘다: A 가 한쪽 변경을 하고 커밋 전에 멈춤 → B 가 반대쪽 변경을 시도 → A 커밋. 고친 뒤에는 B 가 A 를 기다렸다가 A 의 결과를 보고
 * 400 으로 거절돼야 한다. 결과가 커밋돼야 하는 흐름이라 롤백 격리 대신 @AfterEach 로 정리한다.
 */
class RoleKindRaceTest extends IntegrationTestBase {

  private static final long TENANT_ID = 1L;

  @Autowired UserService userService;
  @Autowired RoleService roleService;

  private long admin;
  private long agent;
  private long role;
  private long agentRole;
  private long userWrite;

  @BeforeEach
  void seed() {
    inTenant(
        () -> {
          admin = TestFixtures.createHuman(baseDsl);
          TestFixtures.addMember(baseDsl, admin, TENANT_ID);
          grant(admin, roleId("ADMIN"));
          agent = TestFixtures.createAgentNoToken(baseDsl);
          TestFixtures.addMember(baseDsl, agent, TENANT_ID);
          agentRole = roleId("AGENT");
          grant(agent, agentRole);
          String name = "R770_" + UUID.randomUUID().toString().substring(0, 8);
          role = roleService.createRole(name, null, admin).id();
          userWrite =
              baseDsl
                  .select(PERMISSION.ID)
                  .from(PERMISSION)
                  .where(PERMISSION.CODE.eq("user:write"))
                  .fetchOne(PERMISSION.ID);
          return null;
        });
  }

  @AfterEach
  void cleanup() {
    cleanupInTenant(
        TENANT_ID,
        () -> {
          baseDsl.deleteFrom(USER_ROLE).where(USER_ROLE.USER_ID.in(admin, agent)).execute();
          baseDsl.deleteFrom(ROLE_PERMISSION).where(ROLE_PERMISSION.ROLE_ID.eq(role)).execute();
          baseDsl.deleteFrom(ROLE).where(ROLE.ID.eq(role)).execute();
          baseDsl.deleteFrom(AUDIT_LOG).where(AUDIT_LOG.USER_ID.in(admin, agent)).execute();
        });
    baseDsl.deleteFrom(USER).where(USER.ID.in(admin, agent)).execute();
  }

  @Test
  void 권한을_더하는_중에_그_역할을_AI_에게_주면_늦은_부여가_400() throws Exception {
    Throwable late =
        race(
            () -> {
              roleService.setRolePermissions(role, List.of(userWrite), admin);
              return null;
            },
            () -> {
              userService.setUserRoles(agent, List.of(agentRole, role), admin);
              return null;
            });

    assertThat(late)
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessageContaining("AI 에이전트에게는 관리자 역할이나 관리 권한이 든 역할을 줄 수 없습니다");
    assertThat(agentHoldsRole()).isFalse();
  }

  @Test
  void 역할을_AI_에게_주는_중에_그_역할에_관리_권한을_더하면_늦은_변경이_400() throws Exception {
    Throwable late =
        race(
            () -> {
              userService.setUserRoles(agent, List.of(agentRole, role), admin);
              return null;
            },
            () -> {
              roleService.setRolePermissions(role, List.of(userWrite), admin);
              return null;
            });

    assertThat(late)
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessageContaining("AI 에이전트가 가진 역할에는 관리 권한을 더할 수 없습니다");
    assertThat(roleHasUserWrite()).isFalse();
  }

  /**
   * first 를 tx 안에서 실행하고 커밋 전에 멈춘 채 second 를 다른 스레드로 보낸다. second 가 잠금을 기다리면 그것을 본 뒤, 기다리지 않고 끝나면(고치기
   * 전) 바로 first 를 커밋한다. second 가 던진 예외(없으면 null)를 돌려준다.
   */
  private Throwable race(Supplier<Object> first, Supplier<Object> second) throws Exception {
    CountDownLatch firstDone = new CountDownLatch(1);
    CountDownLatch releaseFirst = new CountDownLatch(1);
    ExecutorService pool = Executors.newFixedThreadPool(2);
    try {
      Future<Object> a =
          pool.submit(
              () ->
                  inTenant(
                      () -> {
                        Object r = first.get();
                        firstDone.countDown();
                        RowLockWaits.awaitQuietly(releaseFirst);
                        return r;
                      }));
      assertThat(firstDone.await(10, TimeUnit.SECONDS)).isTrue();
      Future<Object> b = pool.submit(() -> inTenant(second));
      try {
        RowLockWaits.awaitLockWaiter(b);
      } catch (AssertionError finishedWithoutWaiting) {
        // 잠금 없이 끝났다 — 아래 결과 검증이 무엇이 잘못됐는지 보인다.
      }
      releaseFirst.countDown();
      a.get(10, TimeUnit.SECONDS);
      try {
        b.get(10, TimeUnit.SECONDS);
        return null;
      } catch (ExecutionException e) {
        return e.getCause();
      }
    } finally {
      releaseFirst.countDown();
      pool.shutdownNow();
      pool.awaitTermination(20, TimeUnit.SECONDS);
    }
  }

  private boolean agentHoldsRole() {
    return inTenant(
        () ->
            baseDsl.fetchExists(
                USER_ROLE, USER_ROLE.USER_ID.eq(agent).and(USER_ROLE.ROLE_ID.eq(role))));
  }

  private boolean roleHasUserWrite() {
    return inTenant(
        () ->
            baseDsl.fetchExists(
                ROLE_PERMISSION,
                ROLE_PERMISSION.ROLE_ID.eq(role).and(ROLE_PERMISSION.PERMISSION_ID.eq(userWrite))));
  }

  private void grant(long userId, long roleId) {
    baseDsl
        .insertInto(USER_ROLE)
        .set(USER_ROLE.USER_ID, userId)
        .set(USER_ROLE.ROLE_ID, roleId)
        .execute();
  }

  private long roleId(String name) {
    return baseDsl.select(ROLE.ID).from(ROLE).where(ROLE.NAME.eq(name)).fetchOne(ROLE.ID);
  }

  /** 테넌트 1 트랜잭션에서 실행한다(서비스 호출 스레드마다 TenantContext 를 세운다). */
  private <T> T inTenant(Supplier<T> body) {
    TenantContext.set(TENANT_ID);
    try {
      return new TransactionTemplate(txManager).execute(s -> body.get());
    } finally {
      TenantContext.clear();
    }
  }
}
