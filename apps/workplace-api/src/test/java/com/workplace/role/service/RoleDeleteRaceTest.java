package com.workplace.role.service;

import static com.workplace.jooq.Tables.AUDIT_LOG;
import static com.workplace.jooq.Tables.PERMISSION;
import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.global.tenant.TenantContext;
import com.workplace.role.exception.RoleAssignedException;
import com.workplace.role.exception.RoleNotFoundException;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import com.workplace.user.service.UserService;
import java.util.ArrayList;
import java.util.List;
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
 * 역할 삭제와 그 역할의 권한 변경·사용자 지정이 겹칠 때(WP-822) — 순차와 같은 결과가 나온다.
 *
 * <p>삭제가 먼저면 권한 변경은 404 「역할을 찾을 수 없습니다」, 사용자 지정은 400 「없는 역할이 포함되어 있습니다」, 지정이 먼저면 삭제가 「할당된 역할은 삭제할 수
 * 없습니다」로 거절된다. 고치기 전에는 삭제만 테넌트 관리자 잠금을 잡지 않아, 뒤 요청이 존재 확인을 지난 뒤 외래 키 위반(409 「연결된 다른 데이터가 있어…」)으로
 * 끝나거나, 삭제가 방금 지정된 역할을 CASCADE 로 조용히 지웠다. 먼저 요청을 트랜잭션을 연 채(커밋 전) 멈춰 두고 나중 요청을 보내 결정적으로 만든다.
 */
class RoleDeleteRaceTest extends IntegrationTestBase {

  @Autowired RoleService roleService;
  @Autowired UserService userService;

  private final List<Long> users = new ArrayList<>();
  private long admin;
  private long target;
  private long userRoleId;
  private long roleId;
  private long permissionId;

  @BeforeEach
  void seed() {
    TenantContext.set(1L);
    userRoleId = roleIdOf("USER");
    admin = user("a");
    grant(admin, roleIdOf("ADMIN"));
    target = user("t");
    grant(target, userRoleId);
    permissionId =
        baseDsl
            .select(PERMISSION.ID)
            .from(PERMISSION)
            .where(PERMISSION.CODE.eq("project:read"))
            .fetchOne(PERMISSION.ID);
    String name = "RACE_" + UUID.randomUUID().toString().replace("-", "").substring(0, 8);
    roleId =
        new TransactionTemplate(txManager)
            .execute(st -> roleService.createRole(name.toUpperCase(), null, admin).id());
  }

  @AfterEach
  void cleanup() {
    baseDsl.deleteFrom(USER_ROLE).where(USER_ROLE.USER_ID.in(users)).execute();
    baseDsl.deleteFrom(ROLE).where(ROLE.ID.eq(roleId)).execute();
    baseDsl.deleteFrom(AUDIT_LOG).where(AUDIT_LOG.USER_ID.in(users)).execute();
    baseDsl.deleteFrom(USER).where(USER.ID.in(users)).execute();
    TenantContext.clear();
  }

  private long roleIdOf(String name) {
    return baseDsl.select(ROLE.ID).from(ROLE).where(ROLE.NAME.eq(name)).fetchOne(ROLE.ID);
  }

  private void grant(long userId, long role) {
    baseDsl
        .insertInto(USER_ROLE)
        .set(USER_ROLE.USER_ID, userId)
        .set(USER_ROLE.ROLE_ID, role)
        .execute();
  }

  private long user(String prefix) {
    String s = UUID.randomUUID().toString().substring(0, 8);
    long id =
        baseDsl
            .insertInto(USER)
            .set(USER.USERNAME, prefix + "-" + s)
            .set(USER.PASSWORD, "pw")
            .set(USER.NAME, prefix)
            .set(USER.EMAIL, prefix + "-" + s + "@example.com")
            .returning(USER.ID)
            .fetchOne()
            .getId();
    TestFixtures.addMember(baseDsl, id, 1L);
    users.add(id);
    return id;
  }

  private boolean roleExists() {
    return baseDsl.fetchExists(ROLE, ROLE.ID.eq(roleId));
  }

  /**
   * first 를 트랜잭션 안에서 실행하고 커밋 전에 멈춘 뒤 second 를 보내, 잠시 뒤 first 를 커밋시킨다. second 의 결과(값 또는 예외)를 돌려준다.
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
                            try {
                              release.await(20, TimeUnit.SECONDS);
                            } catch (InterruptedException e) {
                              Thread.currentThread().interrupt();
                            }
                          });
                } finally {
                  TenantContext.clear();
                }
              });
      firstDone.await(10, TimeUnit.SECONDS);
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
      Thread.sleep(800);
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
  void 삭제가_먼저면_권한_변경은_역할을_찾을_수_없다() throws Exception {
    Object r =
        race(
            () -> roleService.deleteRole(roleId, admin),
            () -> {
              roleService.setRolePermissions(roleId, List.of(permissionId), admin);
              return "changed";
            });
    assertThat(r).isInstanceOf(RoleNotFoundException.class);
    assertThat(roleExists()).isFalse();
  }

  @Test
  void 삭제가_먼저면_역할_지정은_없는_역할로_거절된다() throws Exception {
    Object r =
        race(
            () -> roleService.deleteRole(roleId, admin),
            () -> {
              userService.setUserRoles(target, List.of(userRoleId, roleId), admin);
              return "assigned";
            });
    assertThat(r)
        .isInstanceOf(IllegalArgumentException.class)
        .hasFieldOrPropertyWithValue("message", "없는 역할이 포함되어 있습니다");
  }

  @Test
  void 지정이_먼저면_삭제는_할당된_역할이라_거절되고_지정이_남는다() throws Exception {
    Object r =
        race(
            () -> userService.setUserRoles(target, List.of(userRoleId, roleId), admin),
            () -> {
              roleService.deleteRole(roleId, admin);
              return "deleted";
            });
    assertThat(r).isInstanceOf(RoleAssignedException.class);
    assertThat(roleExists()).isTrue();
    assertThat(
            baseDsl.fetchExists(
                USER_ROLE, USER_ROLE.USER_ID.eq(target).and(USER_ROLE.ROLE_ID.eq(roleId))))
        .isTrue();
  }
}
