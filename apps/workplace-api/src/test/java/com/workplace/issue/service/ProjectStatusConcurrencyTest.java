package com.workplace.issue.service;

import static com.workplace.jooq.Tables.AUDIT_LOG;
import static com.workplace.jooq.Tables.PROJECT;
import static com.workplace.jooq.Tables.PROJECT_STATUS;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.global.tenant.TenantContext;
import com.workplace.issue.dto.CreateProjectStatusRequest;
import com.workplace.issue.dto.ProjectStatusResponse;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.dto.ProjectResponse;
import com.workplace.project.service.ProjectService;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.RowLockWaits;
import com.workplace.support.TestFixtures;
import java.util.HashSet;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
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
 * 상태 추가 경합(WP-807) — 두 트랜잭션이 같은 after 로 동시에 상태를 넣어도 position 이 겹치지 않아야 한다. 추가는 프로젝트의 상태 행을 잠근 뒤
 * position 을 정하므로 늦은 쪽은 먼저 쪽의 커밋을 기다렸다가 밀린 position 을 본다.
 *
 * <p>순서를 결정적으로 맞춘다: A 가 넣고 커밋 전에 멈춤 → B 가 같은 after 로 넣으려다 잠금을 기다림(관측) → A 커밋. 두 추가가 커밋돼야 하는 흐름이라
 * 비-{@code @Transactional} 로 두고 자기 프로젝트·사용자만 {@code @AfterEach} 로 정리한다.
 */
class ProjectStatusConcurrencyTest extends IntegrationTestBase {

  @Autowired ProjectStatusService service;
  @Autowired ProjectService projectService;

  private Long owner;
  private ProjectResponse project;

  @BeforeEach
  void seed() {
    TenantContext.set(1L);
    owner = TestFixtures.createHuman(baseDsl);
    TestFixtures.grantRole(baseDsl, owner, "USER");
    TestFixtures.addMember(baseDsl, owner, 1L);
    String key =
        "PSR" + UUID.randomUUID().toString().replace("-", "").toUpperCase().substring(0, 4);
    project = projectService.create(owner, new CreateProjectRequest(key, "P", "x", "TEAM"));
    TenantContext.clear();
  }

  @AfterEach
  void cleanup() {
    long uid = owner;
    cleanupInTenant(
        1L,
        () -> {
          if (project != null) {
            // project 삭제가 project_status 를 cascade 로 지운다
            baseDsl.deleteFrom(PROJECT).where(PROJECT.ID.eq(project.id())).execute();
          }
          baseDsl.deleteFrom(AUDIT_LOG).where(AUDIT_LOG.USER_ID.eq(uid)).execute();
          baseDsl.deleteFrom(USER_ROLE).where(USER_ROLE.USER_ID.eq(uid)).execute();
        });
    baseDsl.deleteFrom(USER).where(USER.ID.eq(uid)).execute();
  }

  @Test
  void 두_트랜잭션이_같은_after로_동시에_추가해도_position이_겹치지_않는다() throws Exception {
    String key = project.key();
    Long inProgress =
        inTenant(
            () ->
                service.list(owner, key).stream()
                    .filter(s -> s.name().equals("진행 중"))
                    .findFirst()
                    .orElseThrow()
                    .id());
    CountDownLatch aInserted = new CountDownLatch(1);
    CountDownLatch releaseA = new CountDownLatch(1);
    ExecutorService pool = Executors.newFixedThreadPool(2);
    try {
      Future<ProjectStatusResponse> a =
          pool.submit(
              () ->
                  inTenant(
                      () -> {
                        var r =
                            service.create(
                                owner,
                                key,
                                new CreateProjectStatusRequest("A", "IN_PROGRESS", inProgress));
                        aInserted.countDown();
                        RowLockWaits.awaitQuietly(releaseA);
                        return r;
                      }));
      assertThat(aInserted.await(10, TimeUnit.SECONDS)).isTrue();
      // A 는 아직 커밋 전 — B 는 같은 프로젝트의 상태 행 잠금을 기다린다.
      Future<ProjectStatusResponse> b =
          pool.submit(
              () ->
                  inTenant(
                      () ->
                          service.create(
                              owner,
                              key,
                              new CreateProjectStatusRequest("B", "IN_PROGRESS", inProgress))));
      RowLockWaits.awaitLockWaiter(b);
      releaseA.countDown();

      a.get(10, TimeUnit.SECONDS);
      b.get(10, TimeUnit.SECONDS);

      List<Integer> positions =
          inTenant(
              () ->
                  baseDsl
                      .select(PROJECT_STATUS.POSITION)
                      .from(PROJECT_STATUS)
                      .where(PROJECT_STATUS.PROJECT_ID.eq(project.id()))
                      .fetch(PROJECT_STATUS.POSITION));
      assertThat(positions).hasSize(6);
      assertThat(new HashSet<>(positions)).hasSize(6);
      assertThat(
              inTenant(
                  () ->
                      service.list(owner, key).stream().map(ProjectStatusResponse::name).toList()))
          .containsExactly("할 일", "진행 중", "B", "A", "완료", "취소");
    } finally {
      releaseA.countDown();
      pool.shutdownNow();
      pool.awaitTermination(20, TimeUnit.SECONDS);
    }
  }

  /** 테넌트 1 트랜잭션에서 실행한다(서비스 호출 스레드마다 TenantContext 를 세운다). */
  private <T> T inTenant(Supplier<T> body) {
    TenantContext.set(1L);
    try {
      return new TransactionTemplate(txManager).execute(s -> body.get());
    } finally {
      TenantContext.clear();
    }
  }
}
