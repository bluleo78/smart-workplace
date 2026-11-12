package com.workplace.help.service;

import static com.workplace.jooq.Tables.HELP_METRIC_DAILY;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.support.IntegrationTestBase;
import java.util.List;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

/**
 * 도움말 측정 180일 보존 정리 시험(WP-1512). 러너가 REQUIRES_NEW 트랜잭션을 열어 미커밋 시드가 보이지 않으므로 {@code @Transactional}
 * 을 쓰지 않고 커밋된 행으로 검증한다.
 */
public class HelpMetricRetentionSchedulerTest extends IntegrationTestBase {

  @Autowired HelpMetricRetentionScheduler scheduler;

  /** 오늘(KST)에서 offset 일 전 날짜로 OPEN 행을 직접 넣는다. */
  private void seed(String route, int offset) {
    baseDsl.execute(
        "INSERT INTO help_metric_daily (day, kind, route, help_id, term, count)"
            + " VALUES ((now() AT TIME ZONE 'Asia/Seoul')::date - ?, 'OPEN', ?, '', '', 1)",
        offset,
        route);
  }

  /** 시험이 남긴 행을 테넌트 1 에서 비운다. */
  @AfterEach
  void cleanup() {
    cleanupInTenant(1L, () -> baseDsl.deleteFrom(HELP_METRIC_DAILY).execute());
  }

  /** 180일 초과 행만 지우고 경계(180일 전)·오늘 행은 남긴다. */
  @Test
  void purgeDeletesRowsOlderThan180DaysAndKeepsBoundary() {
    callInTenant(
        1L,
        () -> {
          seed("/old", 181);
          seed("/edge", 180);
          seed("/new", 0);
          return null;
        });
    scheduler.purge();
    List<String> routes =
        callInTenant(
            1L,
            () ->
                baseDsl
                    .select(HELP_METRIC_DAILY.ROUTE)
                    .from(HELP_METRIC_DAILY)
                    .fetch(HELP_METRIC_DAILY.ROUTE));
    assertThat(routes).containsExactlyInAnyOrder("/edge", "/new");
  }
}
