package com.workplace.issue;

import static com.workplace.jooq.Tables.AUDIT_LOG;
import static com.workplace.jooq.Tables.ISSUE;
import static com.workplace.jooq.Tables.PROJECT;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.component.exception.ComponentException;
import com.workplace.global.tenant.TenantContext;
import com.workplace.issue.service.IssueComponentService;
import com.workplace.support.PostgresTestContainer;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 구성요소 붙이기와 보관·삭제의 경합(WP-933 코드 리뷰) — 구성요소 행을 공유 잠금하지 않으면 보관·삭제가 「보관 여부 확인」과 INSERT 사이에 끼어, 보관된
 * 구성요소가 새로 붙거나 삭제된 구성요소가 일반 409(외래키 위반)로 거절됐다. 잠금 뒤에는 늦게 온 쪽이 먼저 온 쪽의 결과를 읽고 사유 코드로 거절된다.
 *
 * <p>커밋된 데이터로 두 트랜잭션을 실제로 겹친다(테스트 트랜잭션 없음, 끝에 정리). 시간에 기대지 않으려고 붙이기가 보관·삭제 트랜잭션의 잠금을 기다리는 상태가 된 것을
 * {@code pg_blocking_pids} 로 확인한 뒤에 보관·삭제를 커밋시킨다.
 */
class IssueComponentRaceTest extends IssueComponentTestSupport {

  @Autowired IssueComponentService issueComponentService;

  @AfterEach
  void cleanup() {
    var users = List.of(ownerId, woodyId, soonId, outsiderId);
    cleanupInTenant(
        1L,
        () -> {
          baseDsl.deleteFrom(ISSUE).where(ISSUE.PROJECT_ID.eq(projectId)).execute();
          baseDsl.deleteFrom(AUDIT_LOG).where(AUDIT_LOG.USER_ID.in(users)).execute();
          baseDsl.deleteFrom(PROJECT).where(PROJECT.ID.eq(projectId)).execute();
          baseDsl.deleteFrom(USER_ROLE).where(USER_ROLE.USER_ID.in(users)).execute();
          baseDsl.deleteFrom(USER).where(USER.ID.in(users)).execute();
        });
  }

  /** 보관이 먼저 잡혀 있는 동안 새로 붙이려던 요청은 보관 커밋을 기다렸다가 COMPONENT_ARCHIVED 로 거절된다. */
  @Test
  void attachWaitsForConcurrentArchive() throws Exception {
    long c = callInTenant(1L, () -> component("Alpha", null));
    int number = createdIssue(ownerId, Map.of()).get("number").asInt();

    Throwable result =
        replaceWhileHeld(
            number, c, "UPDATE project_component SET archived_at = now() WHERE id = " + c);

    assertThat(result).isInstanceOf(ComponentException.class);
    assertThat(((ComponentException) result).errors()).containsEntry("code", "COMPONENT_ARCHIVED");
    assertThat(baseDsl.fetchCount(com.workplace.jooq.Tables.ISSUE_COMPONENT)).isZero();
  }

  /** 삭제가 먼저 잡혀 있는 동안 붙이려던 요청은 외래키 위반(일반 409) 대신 COMPONENT_NOT_FOUND 로 거절된다. */
  @Test
  void attachWaitsForConcurrentDelete() throws Exception {
    long c = callInTenant(1L, () -> component("Alpha", null));
    int number = createdIssue(ownerId, Map.of()).get("number").asInt();

    Throwable result = replaceWhileHeld(number, c, "DELETE FROM project_component WHERE id = " + c);

    assertThat(result).isInstanceOf(ComponentException.class);
    assertThat(((ComponentException) result).errors()).containsEntry("code", "COMPONENT_NOT_FOUND");
    assertThat(baseDsl.fetchCount(com.workplace.jooq.Tables.ISSUE_COMPONENT)).isZero();
  }

  /**
   * holdSql 을 실행한 트랜잭션을 커밋 없이 붙잡아 둔 채 {@code replace} 를 시작하고, 그것이 구성요소 행 잠금에서 기다리는 것을 확인한 뒤 커밋시킨다.
   * replace 가 던진 예외(없으면 null)를 돌려준다.
   */
  private Throwable replaceWhileHeld(int number, long componentId, String holdSql)
      throws Exception {
    CountDownLatch held = new CountDownLatch(1);
    CountDownLatch release = new CountDownLatch(1);
    AtomicInteger holderPid = new AtomicInteger();
    ExecutorService pool = Executors.newFixedThreadPool(2);
    try {
      Future<?> holder =
          pool.submit(
              () -> {
                TenantContext.set(1L);
                try {
                  new TransactionTemplate(txManager)
                      .executeWithoutResult(
                          st -> {
                            baseDsl.execute(holdSql);
                            holderPid.set(
                                ((Number) baseDsl.fetchValue("SELECT pg_backend_pid()"))
                                    .intValue());
                            held.countDown();
                            try {
                              release.await(60, TimeUnit.SECONDS);
                            } catch (InterruptedException e) {
                              Thread.currentThread().interrupt();
                            }
                          });
                } finally {
                  TenantContext.clear();
                }
              });
      assertThat(held.await(30, TimeUnit.SECONDS)).as("보관·삭제가 커밋 직전에 멈춤").isTrue();

      Future<Throwable> attach =
          pool.submit(
              () -> {
                TenantContext.set(1L);
                try {
                  issueComponentService.replace(ownerId, key, number, List.of(componentId));
                  return null;
                } catch (RuntimeException e) {
                  return e;
                } finally {
                  TenantContext.clear();
                }
              });
      assertThat(awaitBlockedBy(holderPid.get())).as("붙이기가 구성요소 행 잠금에서 대기").isTrue();

      release.countDown();
      holder.get(30, TimeUnit.SECONDS);
      return attach.get(30, TimeUnit.SECONDS);
    } finally {
      release.countDown();
      pool.shutdownNow();
      pool.awaitTermination(30, TimeUnit.SECONDS);
    }
  }

  /** blockerPid 의 잠금을 기다리는 백엔드가 생길 때까지 기다린다(조건 확인 — 상한은 안전장치). 풀 밖의 별도 접속으로 본다. */
  private static boolean awaitBlockedBy(int blockerPid) throws Exception {
    var c = PostgresTestContainer.INSTANCE;
    try (Connection conn =
            DriverManager.getConnection(c.getJdbcUrl(), c.getUsername(), c.getPassword());
        PreparedStatement ps =
            conn.prepareStatement(
                "SELECT count(*) FROM pg_stat_activity WHERE ? = ANY(pg_blocking_pids(pid))")) {
      ps.setInt(1, blockerPid);
      long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(30);
      while (System.nanoTime() < deadline) {
        try (ResultSet rs = ps.executeQuery()) {
          rs.next();
          if (rs.getLong(1) > 0) return true;
        }
        TimeUnit.MILLISECONDS.sleep(10);
      }
      return false;
    }
  }
}
