package com.workplace.project.service;

import static com.workplace.jooq.Tables.AUDIT_LOG;
import static com.workplace.jooq.Tables.PROJECT;
import static com.workplace.jooq.Tables.PROJECT_MEMBER;
import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.global.tenant.TenantContext;
import com.workplace.project.dto.AddMemberRequest;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.dto.UpdateMemberRoleRequest;
import com.workplace.project.exception.ProjectConflictException;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
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
 * 프로젝트의 두 소유자가 서로를 동시에 강등·제거해도 소유자가 0명이 되지 않는다(WP-753).
 *
 * <p>「마지막 소유자인가」 확인(COUNT)과 강등·제거 사이가 비어 있어, 두 요청이 서로 커밋 전의 소유자 2명을 보고 둘 다 성공해 소유자 0명이 됐다 — 그러면 멤버
 * 관리를 할 사람이 없는 프로젝트가 남는다. 이제 확인 전에 그 프로젝트의 소유자 행들을 잠가, 나중 요청은 앞 요청이 커밋한 뒤의 소유자로 판정한다. 먼저 요청을 트랜잭션을
 * 연 채(커밋 전) 멈춰 두고 나중 요청을 보내 결정적으로 만든다. 같은 처방을 팀 드라이브·노트 공간에 한 {@code
 * TeamSpaceLastOwnerRaceTest}(WP-788)와 같은 모양이다.
 */
class ProjectLastOwnerRaceTest extends IntegrationTestBase {

  @Autowired ProjectService projectService;

  private final List<Long> users = new ArrayList<>();
  private long alice;
  private long bob;
  private Long projectId;
  private String projectKey;

  @BeforeEach
  void seed() {
    TenantContext.set(1L);
    alice = user("alice");
    bob = user("bob");
    projectKey = "R" + UUID.randomUUID().toString().replace("-", "").substring(0, 6).toUpperCase();
    projectId =
        projectService.create(alice, new CreateProjectRequest(projectKey, "owner race", null)).id();
    projectService.addMember(alice, projectKey, new AddMemberRequest(bob, "OWNER"));
  }

  @AfterEach
  void cleanup() {
    cleanupInTenant(
        1L,
        () -> {
          baseDsl.deleteFrom(PROJECT).where(PROJECT.ID.eq(projectId)).execute();
          baseDsl.deleteFrom(AUDIT_LOG).where(AUDIT_LOG.USER_ID.in(users)).execute();
        });
    baseDsl.deleteFrom(USER_ROLE).where(USER_ROLE.USER_ID.in(users)).execute();
    baseDsl.deleteFrom(USER).where(USER.ID.in(users)).execute();
    TenantContext.clear();
  }

  @Test
  void 두_소유자가_서로를_동시에_강등하면_나중_요청은_409() throws Exception {
    Object r =
        race(
            () ->
                projectService.updateMemberRole(
                    alice, projectKey, bob, new UpdateMemberRoleRequest("MEMBER")),
            () -> {
              projectService.updateMemberRole(
                  bob, projectKey, alice, new UpdateMemberRoleRequest("MEMBER"));
              return "demoted";
            });
    assertThat(r).isInstanceOf(ProjectConflictException.class);
    assertThat(owners()).containsExactly(alice);
  }

  @Test
  void 두_소유자가_서로를_동시에_제거하면_나중_요청은_409() throws Exception {
    Object r =
        race(
            () -> projectService.removeMember(alice, projectKey, bob),
            () -> {
              projectService.removeMember(bob, projectKey, alice);
              return "removed";
            });
    assertThat(r).isInstanceOf(ProjectConflictException.class);
    assertThat(owners()).containsExactly(alice);
  }

  private List<Long> owners() {
    return baseDsl
        .select(PROJECT_MEMBER.USER_ID)
        .from(PROJECT_MEMBER)
        .where(PROJECT_MEMBER.PROJECT_ID.eq(projectId))
        .and(PROJECT_MEMBER.ROLE.eq("OWNER"))
        .fetch(PROJECT_MEMBER.USER_ID);
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
    Long roleId = baseDsl.select(ROLE.ID).from(ROLE).where(ROLE.NAME.eq("USER")).fetchOne(ROLE.ID);
    baseDsl
        .insertInto(USER_ROLE)
        .set(USER_ROLE.USER_ID, id)
        .set(USER_ROLE.ROLE_ID, roleId)
        .execute();
    TestFixtures.addMember(baseDsl, id, 1L);
    users.add(id);
    return id;
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
}
