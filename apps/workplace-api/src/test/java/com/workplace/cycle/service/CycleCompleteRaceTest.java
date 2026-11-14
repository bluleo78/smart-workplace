package com.workplace.cycle.service;

import static com.workplace.jooq.Tables.AUDIT_LOG;
import static com.workplace.jooq.Tables.CYCLE;
import static com.workplace.jooq.Tables.PROJECT;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.cycle.dto.CreateCycleRequest;
import com.workplace.cycle.dto.CycleCompleteRequest;
import com.workplace.cycle.dto.CycleCompleteRequest.Destination;
import com.workplace.cycle.exception.InvalidCycleStatusException;
import com.workplace.global.tenant.TenantContext;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.service.ProjectService;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.RowLockWaits;
import com.workplace.support.TestFixtures;
import java.time.LocalDate;
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
 * 같은 사이클을 두 요청이 동시에 완료해도 한 번만 완료된다(WP-1578 리뷰).
 *
 * <p>완료는 「진행 중인가」·「보낼 사이클이 예정인가」 확인 뒤 쓰기를 한다. 행을 잠그지 않으면 두 요청이 서로 커밋 전의 진행 중 상태를 보고 둘 다 통과해 새 사이클이
 * 두 개 생기거나, 같은 예정 사이클을 두 번 시작한다. 이제 완료 사이클과 보낼 예정 사이클 행을 확인 전에 잠가 나중 요청은 앞 요청이 커밋한 뒤의 상태로 판정한다. 먼저
 * 요청을 트랜잭션을 연 채(커밋 전) 멈춰 두고 나중 요청을 보내 결정적으로 만든다({@code ProjectLastOwnerRaceTest} 와 같은 모양).
 */
class CycleCompleteRaceTest extends IntegrationTestBase {

  @Autowired CycleService cycleService;
  @Autowired ProjectService projectService;

  private static final LocalDate D1 = LocalDate.of(2026, 6, 1);
  private static final LocalDate D14 = LocalDate.of(2026, 6, 14);
  private static final LocalDate D15 = LocalDate.of(2026, 6, 15);
  private static final LocalDate D28 = LocalDate.of(2026, 6, 28);

  private final List<Long> users = new ArrayList<>();
  private long owner;
  private Long projectId;
  private String projectKey;

  @BeforeEach
  void seed() {
    TenantContext.set(1L);
    owner = user();
    projectKey = "R" + UUID.randomUUID().toString().replace("-", "").substring(0, 6).toUpperCase();
    projectId =
        projectService.create(owner, new CreateProjectRequest(projectKey, "cycle race", null)).id();
  }

  @AfterEach
  void cleanup() {
    // 사이클은 프로젝트 삭제에 CASCADE — 이슈는 만들지 않았다
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

  /** 같은 사이클을 동시에 완료하면 나중 요청은 「진행 중 아님」 400 이고 새 사이클은 하나만 생긴다. */
  @Test
  void 같은_사이클을_동시에_완료하면_나중_요청은_거절된다() throws Exception {
    long active = cycle("GW-1", D1, D14, "ACTIVE");

    Object r =
        race(
            () -> cycleService.complete(owner, projectKey, active, toNew("GW-2")),
            () -> cycleService.complete(owner, projectKey, active, toNew("GW-3")));

    assertThat(r).isInstanceOf(InvalidCycleStatusException.class);
    assertThat(cycleNames()).containsExactlyInAnyOrder("GW-1", "GW-2");
  }

  /** 서로 다른 진행 중 사이클 둘이 같은 예정 사이클로 동시에 보내면 나중 요청은 「예정 아님」 400 이다. */
  @Test
  void 같은_예정_사이클로_동시에_보내면_나중_요청은_거절된다() throws Exception {
    long a = cycle("GW-A", D1, D14, "ACTIVE");
    long b = cycle("GW-B", D1, D14, "ACTIVE");
    long planned = cycle("GW-P", D15, D28, "PLANNED");

    Object r =
        race(
            () -> cycleService.complete(owner, projectKey, a, toScheduled(planned)),
            () -> cycleService.complete(owner, projectKey, b, toScheduled(planned)));

    assertThat(r).isInstanceOf(InvalidCycleStatusException.class);
    assertThat(statusOf(b)).isEqualTo("ACTIVE");
  }

  private static CycleCompleteRequest toNew(String name) {
    return new CycleCompleteRequest(Destination.NEW, null, null, name, D15, D28);
  }

  private static CycleCompleteRequest toScheduled(long target) {
    return new CycleCompleteRequest(Destination.SCHEDULED, target, true, null, null, null);
  }

  private long cycle(String name, LocalDate start, LocalDate end, String status) {
    return cycleService
        .create(owner, projectKey, new CreateCycleRequest(name, null, start, end, status))
        .id();
  }

  private List<String> cycleNames() {
    return callInTenant(
        1L,
        () ->
            baseDsl
                .select(CYCLE.NAME)
                .from(CYCLE)
                .where(CYCLE.PROJECT_ID.eq(projectId))
                .fetch(CYCLE.NAME));
  }

  private String statusOf(long cycleId) {
    return callInTenant(
        1L,
        () ->
            baseDsl
                .select(CYCLE.STATUS)
                .from(CYCLE)
                .where(CYCLE.ID.eq(cycleId))
                .fetchOne(CYCLE.STATUS));
  }

  /** USER 역할의 테넌트#1 멤버를 만들고 정리 대상에 올린다(이 테스트는 커밋하므로 끝에 지운다). */
  private long user() {
    long id = TestFixtures.createHuman(baseDsl);
    TestFixtures.grantRole(baseDsl, id, "USER");
    TestFixtures.addMember(baseDsl, id, 1L);
    users.add(id);
    return id;
  }

  /**
   * first 를 트랜잭션 안에서 실행하고 커밋 전에 멈춘 뒤 second 를 보내, second 가 행 잠금을 기다리는 것을 확인하고 first 를 커밋시킨다. second
   * 의 결과(값 또는 예외)를 돌려준다. 고정 sleep 대신 pg_locks 로 잠금 대기 진입을 확인해({@link RowLockWaits#awaitLockWaiter},
   * 상한 10초) 부하에서도 순서가 같고 평소엔 바로 넘어간다 — second 가 잠금에 닿기 전에 끝나면(잠금이 안 걸렸으면) 거기서 실패한다.
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
}
