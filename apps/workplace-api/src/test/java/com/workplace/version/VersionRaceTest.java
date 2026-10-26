package com.workplace.version;

import static com.workplace.jooq.Tables.AUDIT_LOG;
import static com.workplace.jooq.Tables.ISSUE;
import static com.workplace.jooq.Tables.PROJECT;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.global.tenant.TenantContext;
import com.workplace.issue.dto.ReplaceVersionsRequest;
import com.workplace.issue.service.IssueVersionService;
import com.workplace.version.dto.ReleaseVersionRequest;
import com.workplace.version.service.VersionService;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.Callable;
import java.util.concurrent.CyclicBarrier;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

/**
 * 같은 이슈에 대한 버전 교체(PUT)와 출시 옮기기가 겹쳐도 교착·오류 없이 끝나는지(WP-888). 두 경로 모두 이슈 행 → 버전 행 순서로 잠그므로 어느 쪽이 먼저
 * 끝나든 결과는 둘 중 하나의 직렬 실행과 같다.
 *
 * <p>커밋된 데이터로 두 트랜잭션을 실제로 겹친다(테스트 트랜잭션 없음, 끝에 정리). 시간 단언·sleep 없이 매 회 두 스레드를 장벽에서 함께 출발시키고, 어떤 순서로
 * 겹쳤든 성립해야 하는 결과만 확인한다 — 잠금 순서가 뒤집히면 Postgres 교착 감지가 한쪽을 실패시켜 예외로 드러난다.
 */
class VersionRaceTest extends VersionOpsTestSupport {

  private static final int ROUNDS = 20;

  @Autowired IssueVersionService issueVersionService;
  @Autowired VersionService versionService;

  @AfterEach
  void cleanup() {
    if (key == null) return;
    var users = List.of(ownerId, memberId);
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

  /**
   * 수정 버전 {A} 인 이슈에 「[A, C] 로 교체」와 「A 출시 + 끝나지 않은 이슈를 B 로 옮기기」를 동시에 20회. 교체가 먼저면 {A,C} → 옮겨 {B,C},
   * 출시가 먼저면 {B} → 교체로 {A,C}(출시된 버전은 다시 붙일 수 있다) — 최종은 둘 중 하나여야 한다.
   */
  @Test
  void concurrentReplaceAndReleaseNoDeadlock() throws Exception {
    callInTenant(
        1L,
        () -> {
          seedProject();
          return null;
        });
    ExecutorService pool = Executors.newFixedThreadPool(2);
    try {
      for (int round = 1; round <= ROUNDS; round++) {
        final int number = round;
        long[] ids =
            callInTenant(
                1L,
                () -> {
                  long issue = seedIssue(number, "TODO");
                  long a = version("A" + number);
                  long b = version("B" + number);
                  long c = version("C" + number);
                  link(issue, a, "FIX");
                  return new long[] {issue, a, b, c};
                });
        long issue = ids[0];
        long a = ids[1];
        long b = ids[2];
        long c = ids[3];

        CyclicBarrier start = new CyclicBarrier(2);
        Future<?> replace =
            pool.submit(
                inTenant(
                    start,
                    () ->
                        issueVersionService.replace(
                            ownerId,
                            key,
                            number,
                            new ReplaceVersionsRequest(List.of(a, c), null))));
        Future<?> release =
            pool.submit(
                inTenant(
                    start,
                    () ->
                        versionService.release(
                            ownerId, key, a, new ReleaseVersionRequest(null, b))));
        // 상한은 멈춤 방지용 안전장치일 뿐 — 정상이면 즉시 끝난다. 예외(교착 포함)는 get 이 그대로 던진다.
        replace.get(60, TimeUnit.SECONDS);
        release.get(60, TimeUnit.SECONDS);

        List<Long> fix = callInTenant(1L, () -> versionIds(issue, "FIX"));
        List<List<Long>> allowed = new ArrayList<>();
        allowed.add(sorted(b, c));
        allowed.add(sorted(a, c));
        assertThat(allowed).as("회차 %d 최종 수정 버전", round).contains(fix);
      }
    } finally {
      pool.shutdownNow();
      pool.awaitTermination(30, TimeUnit.SECONDS);
    }
  }

  /** 스레드에 테넌트 문맥을 세우고 장벽에서 상대를 기다린 뒤 body 를 실행한다. */
  private static Callable<Void> inTenant(CyclicBarrier start, Runnable body) {
    return () -> {
      TenantContext.set(1L);
      try {
        start.await(30, TimeUnit.SECONDS);
        body.run();
        return null;
      } finally {
        TenantContext.clear();
      }
    };
  }

  private static List<Long> sorted(long x, long y) {
    return x < y ? List.of(x, y) : List.of(y, x);
  }
}
