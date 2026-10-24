package com.workplace;

import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.support.IntegrationTestBase;
import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;
import java.util.TimeZone;
import org.jooq.DSLContext;
import org.jooq.impl.DSL;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

/**
 * 실행 환경과 무관한 UTC 기본 시간대 (WP-939).
 *
 * <p>pgjdbc 는 DB 세션 TimeZone 을 JVM 기본 시간대로 맞춘다. 로컬(KST) JVM 이면 시간대 없는 TIMESTAMP 의 {@code DEFAULT
 * NOW()} 가 KST 벽시계로 저장돼 웹(UTC 로 읽음)에 9시간 어긋나 보였다. 테스트 JVM(build.gradle.kts)과 앱
 * 진입점(WorkplaceApplication.main)이 모두 UTC 로 고정하는지 확인한다.
 */
class UtcDefaultTimeZoneTest extends IntegrationTestBase {

  @Autowired private DSLContext dsl;

  @Test
  void testJvm_andDbSession_areUtc() {
    assertThat(TimeZone.getDefault().getID()).isIn("UTC", "Etc/UTC");
    assertThat(dsl.fetchValue(DSL.field("current_setting('TimeZone')", String.class)))
        .isIn("UTC", "Etc/UTC");
  }

  @Test
  void naiveTimestampNow_isUtcWallClock() {
    // 시간대 없는 TIMESTAMP 칼럼의 DEFAULT NOW() 와 같은 값 — 세션이 UTC 면 UTC 벽시계여야 한다.
    LocalDateTime dbNow = dsl.fetchValue(DSL.field("LOCALTIMESTAMP", LocalDateTime.class));
    assertThat(Math.abs(ChronoUnit.SECONDS.between(dbNow, LocalDateTime.now(ZoneOffset.UTC))))
        .isLessThan(60);
  }

  @Test
  void useUtcDefaultTimeZone_overridesHostZone() {
    TimeZone before = TimeZone.getDefault();
    try {
      TimeZone.setDefault(TimeZone.getTimeZone("Asia/Seoul"));
      WorkplaceApplication.useUtcDefaultTimeZone();
      assertThat(TimeZone.getDefault().getID()).isEqualTo("UTC");
    } finally {
      TimeZone.setDefault(before);
    }
  }
}
