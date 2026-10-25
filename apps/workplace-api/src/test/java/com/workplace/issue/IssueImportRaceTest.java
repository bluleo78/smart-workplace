package com.workplace.issue;

import static com.workplace.jooq.Tables.AUDIT_LOG;
import static com.workplace.jooq.Tables.ISSUE;
import static com.workplace.jooq.Tables.PROJECT;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.global.tenant.TenantContext;
import com.workplace.issue.dto.ImportIssueRequest;
import com.workplace.issue.exception.IssueImportException;
import com.workplace.issue.service.IssueImportService;
import com.workplace.support.PostgresTestContainer;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.time.OffsetDateTime;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 가져오기 시간 초과 뒤 재시도(WP-883) — 첫 요청이 아직 커밋되지 않은 사이에 같은 원본 키·번호로 재시도가 오면, 재시도는 원본 키 사전 확인을 통과한 뒤 번호
 * 시퀀스 잠금에서 기다린다. 첫 요청이 커밋된 뒤 재시도가 받아야 할 답은 「이미 들어갔다」(IMPORT_SOURCE_KEY_TAKEN)이지 번호 중복이 아니다 — 스크립트는
 * 원본 키 409 만 건너뛸 신호로 쓴다.
 *
 * <p>커밋된 데이터로 두 트랜잭션을 실제로 겹친다(테스트 트랜잭션 없음, 끝에 정리). 시간에 기대지 않으려고 재시도가 첫 요청의 잠금을 기다리는 상태가 된 것을 {@code
 * pg_blocking_pids} 로 확인한 뒤에 첫 요청을 커밋시킨다.
 */
class IssueImportRaceTest extends IssueImportTestSupport {

  @Autowired IssueImportService importService;

  @BeforeEach
  void seed() {
    seedProject("IR", "경합");
  }

  @AfterEach
  void cleanup() {
    cleanupInTenant(
        1L,
        () -> {
          baseDsl.deleteFrom(ISSUE).where(ISSUE.PROJECT_ID.eq(projectId)).execute();
          baseDsl.deleteFrom(AUDIT_LOG).where(AUDIT_LOG.USER_ID.in(users)).execute();
          baseDsl.deleteFrom(PROJECT).where(PROJECT.ID.eq(projectId)).execute();
          baseDsl.deleteFrom(USER_ROLE).where(USER_ROLE.USER_ID.in(users)).execute();
          baseDsl.deleteFrom(USER).where(USER.ID.in(users)).execute();
        });
    TenantContext.clear();
  }

  /** 번호·원본 키를 지정한 최소 가져오기 요청. */
  private ImportIssueRequest request(int number, String sourceKey) {
    return new ImportIssueRequest(
        number,
        sourceKey,
        "재시도 대상",
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        username(reporter),
        null,
        null,
        OffsetDateTime.parse("2026-06-11T09:00:00+09:00"),
        null,
        null,
        null,
        null,
        null,
        null);
  }

  /**
   * blockerPid 의 잠금을 기다리며 번호 시퀀스 행을 갱신하려는 백엔드가 생길 때까지 기다린다(조건 확인 — 상한은 안전장치일 뿐). 테스트 풀(최대 2)은 두 요청이
   * 쥐고 있으므로 풀 밖의 별도 접속으로 본다.
   */
  private static boolean awaitBlockedOnSequence(int blockerPid) throws Exception {
    var c = PostgresTestContainer.INSTANCE;
    try (Connection conn =
            DriverManager.getConnection(c.getJdbcUrl(), c.getUsername(), c.getPassword());
        PreparedStatement ps =
            conn.prepareStatement(
                "SELECT count(*) FROM pg_stat_activity WHERE ? = ANY(pg_blocking_pids(pid))"
                    + " AND query ILIKE '%project_issue_sequence%'")) {
      ps.setInt(1, blockerPid);
      long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(30);
      while (System.nanoTime() < deadline) {
        try (ResultSet rs = ps.executeQuery()) {
          rs.next();
          if (rs.getLong(1) > 0) return true;
        }
        TimeUnit.MILLISECONDS.sleep(10); // 다시 확인하기 전 잠깐 양보(판정은 조건으로만 한다)
      }
      return false;
    }
  }

  @Test
  void retryWhileFirstUncommitted_getsSourceKeyTaken_notNumberTaken() throws Exception {
    ImportIssueRequest req = request(7, "CLIM-RACE-" + UUID.randomUUID());
    CountDownLatch held = new CountDownLatch(1);
    CountDownLatch release = new CountDownLatch(1);
    AtomicInteger firstPid = new AtomicInteger();
    ExecutorService pool = Executors.newFixedThreadPool(2);
    try {
      // 첫 요청 — 가져오기를 마친 뒤 커밋하지 않고 멈춘다(시퀀스 행 잠금을 쥔 채).
      Future<?> first =
          pool.submit(
              () -> {
                TenantContext.set(1L);
                try {
                  new TransactionTemplate(txManager)
                      .executeWithoutResult(
                          st -> {
                            importService.importIssue(admin, key, req);
                            firstPid.set(
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
      assertThat(held.await(30, TimeUnit.SECONDS)).as("첫 요청이 커밋 직전에 멈춤").isTrue();

      // 재시도 — 원본 키 사전 확인은 미커밋이라 통과하고, 시퀀스 행 잠금에서 기다린다.
      Future<Object> retry =
          pool.submit(
              () -> {
                TenantContext.set(1L);
                try {
                  return importService.importIssue(admin, key, req);
                } catch (RuntimeException e) {
                  return e;
                } finally {
                  TenantContext.clear();
                }
              });
      assertThat(awaitBlockedOnSequence(firstPid.get())).as("재시도가 시퀀스 잠금에서 대기").isTrue();

      release.countDown();
      first.get(30, TimeUnit.SECONDS);
      Object result = retry.get(30, TimeUnit.SECONDS);

      assertThat(result).isInstanceOf(IssueImportException.class);
      assertThat(((IssueImportException) result).errors().get("reason"))
          .isEqualTo("IMPORT_SOURCE_KEY_TAKEN");
      assertThat(baseDsl.fetchCount(ISSUE, ISSUE.PROJECT_ID.eq(projectId))).isEqualTo(1);
    } finally {
      release.countDown();
      pool.shutdownNow();
      pool.awaitTermination(30, TimeUnit.SECONDS);
    }
  }
}
