package com.workplace.user;

import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_GROUP;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.global.tenant.TenantContext;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.RowLockWaits;
import com.workplace.support.TestFixtures;
import com.workplace.user.dto.CreateUserGroupRequest;
import com.workplace.user.dto.UpdateUserGroupRequest;
import com.workplace.user.exception.InvalidUserGroupException;
import com.workplace.user.service.UserGroupService;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 사용자 그룹 두 개를 서로의 하위로 동시에 옮길 때(WP-790) — 순환이 생기지 않는다.
 *
 * <p>순환 검사(자손 집합)와 부모 변경 사이에 다른 이동이 끼면, 두 요청이 서로 커밋 전의 트리를 보고 둘 다 통과해 X→Y·Y→X 순환이 저장됐다. 먼저 이동을
 * 트랜잭션을 연 채(커밋 전) 멈춰 두고 나중 이동을 보내 결정적으로 만든다 — 나중 이동은 먼저 이동의 커밋을 기다렸다 X 가 Y 의 자손임을 보고 거절돼야 한다.
 */
class UserGroupMoveCycleRaceTest extends IntegrationTestBase {

  @Autowired UserGroupService service;

  private long owner;
  private long x;
  private long y;

  @BeforeEach
  void seed() {
    TenantContext.set(1L);
    String t = UUID.randomUUID().toString().replace("-", "").substring(0, 8);
    owner =
        baseDsl
            .insertInto(USER)
            .set(USER.USERNAME, "ug_" + t)
            .set(USER.PASSWORD, "pw")
            .set(USER.NAME, "User " + t)
            .set(USER.EMAIL, t + "@example.com")
            .set(USER.KIND, "HUMAN")
            .returning(USER.ID)
            .fetchOne()
            .getId();
    TestFixtures.addMember(baseDsl, owner, 1L);
    x = service.create(owner, new CreateUserGroupRequest("X", null, "PERSONAL", null, 0)).id();
    y = service.create(owner, new CreateUserGroupRequest("Y", null, "PERSONAL", null, 0)).id();
  }

  @AfterEach
  void cleanup() {
    cleanupInTenant(
        1L,
        () -> {
          // 순환이 남았으면 자기참조 FK 때문에 지우기 전에 끊는다.
          baseDsl
              .update(USER_GROUP)
              .setNull(USER_GROUP.PARENT_ID)
              .where(USER_GROUP.OWNER_ID.eq(owner))
              .execute();
          baseDsl.deleteFrom(USER_GROUP).where(USER_GROUP.OWNER_ID.eq(owner)).execute();
        });
    baseDsl.deleteFrom(USER).where(USER.ID.eq(owner)).execute();
    TenantContext.clear();
  }

  private static UpdateUserGroupRequest moveUnder(long parentId) {
    return new UpdateUserGroupRequest(null, parentId, null, null, null, null);
  }

  /** 그룹의 현재 부모 id(최상위면 null). */
  private Long parentOf(long id) {
    TenantContext.set(1L);
    return new TransactionTemplate(txManager)
        .execute(
            st ->
                baseDsl
                    .select(USER_GROUP.PARENT_ID)
                    .from(USER_GROUP)
                    .where(USER_GROUP.ID.eq(id))
                    .fetchOne(USER_GROUP.PARENT_ID));
  }

  /**
   * first 를 트랜잭션 안에서 실행하고 커밋 전에 멈춘 뒤 second 를 보내, second 가 그 잠금을 기다리는 것을 확인한 뒤 first 를 커밋시킨다.
   * second 의 결과(값 또는 예외)를 돌려준다.
   */
  private Object race(Runnable first, Callable<Object> second) throws Exception {
    CountDownLatch firstDone = new CountDownLatch(1);
    CountDownLatch release = new CountDownLatch(1);
    ExecutorService pool = Executors.newFixedThreadPool(2);
    try {
      Future<?> f1 =
          pool.submit(
              () -> {
                TenantContext.set(1L);
                try {
                  new TransactionTemplate(txManager)
                      .executeWithoutResult(
                          st -> {
                            first.run();
                            firstDone.countDown();
                            // 커밋 전에 멈춰 잠금을 쥔 채 second 가 그 잠금을 기다릴 때까지 둔다.
                            // 상한은 main 의 잠금 대기 확인(최대 10초)보다 넉넉히 — 놓아 주기 전에 먼저 풀려 순서가 바뀌지 않게.
                            try {
                              if (!release.await(30, TimeUnit.SECONDS)) {
                                throw new AssertionError("release 신호가 오지 않았다");
                              }
                            } catch (InterruptedException e) {
                              Thread.currentThread().interrupt();
                              throw new AssertionError(e);
                            }
                          });
                } finally {
                  TenantContext.clear();
                }
              });
      // first 가 커밋 전 멈춤에 닿지 못했으면(예외·지연) 순서를 보장할 수 없다 — 결과를 버리지 않고 그 이유로 실패한다(WP-1647).
      if (!firstDone.await(30, TimeUnit.SECONDS)) {
        if (f1.isDone()) f1.get();
        throw new AssertionError("first 가 커밋 전 멈춤에 닿지 못했다");
      }
      Future<Object> f2 =
          pool.submit(
              () -> {
                TenantContext.set(1L);
                try {
                  return second.call();
                } catch (Exception e) {
                  return e;
                } finally {
                  TenantContext.clear();
                }
              });
      // second 가 first 의 잠금을 실제로 기다리는 상태가 된 뒤에 first 를 커밋시킨다 — sleep 으로 가정하면 부하에서 순서가
      // 어긋난다(WP-1646·1647).
      RowLockWaits.awaitLockWaiter(f2);
      release.countDown();
      f1.get(20, TimeUnit.SECONDS);
      return f2.get(20, TimeUnit.SECONDS);
    } finally {
      release.countDown();
      pool.shutdownNow();
      pool.awaitTermination(30, TimeUnit.SECONDS);
    }
  }

  @Test
  void 서로의_하위로_동시에_옮기면_나중_이동은_400이고_순환이_생기지_않는다() throws Exception {
    Object r =
        race(
            () -> service.update(owner, x, moveUnder(y)),
            () -> service.update(owner, y, moveUnder(x)));
    assertThat(r)
        .isInstanceOf(InvalidUserGroupException.class)
        .hasFieldOrPropertyWithValue("message", "그룹을 자손 그룹의 하위로 옮길 수 없습니다");
    assertThat(parentOf(x)).isEqualTo(y);
    assertThat(parentOf(y)).isNull();
  }
}
