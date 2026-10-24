package com.workplace.audit.repository;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.within;
import static org.jooq.impl.DSL.field;
import static org.jooq.impl.DSL.name;
import static org.jooq.impl.DSL.table;

import com.workplace.audit.dto.AuditLogResponse;
import com.workplace.support.IntegrationTestBase;
import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/**
 * 감사 로그 시각의 UTC 저장 (WP-938).
 *
 * <p>action_time 은 시간대 없는 TIMESTAMP 라 기본값 NOW() 는 세션 TimeZone(pgjdbc 가 JVM 기본 시간대로 맞춤)의 벽시계가 됐다.
 * KST JVM 이면 KST 시각이 들어가 웹(UTC 로 읽음)에 +9시간으로 보였다. V209 가 기본값을 UTC 벽시계로 바꾼 것을, 세션 시간대를 서울로 둔 채 저장해
 * 확인한다.
 */
@Transactional
class AuditLogActionTimeUtcTest extends IntegrationTestBase {

  @Autowired private AuditLogRepository repository;
  @Autowired private DSLContext dsl;

  /** 시스템 행위 한 건 저장 — 설명에 고유 태그를 넣어 다른 테스트 행과 섞이지 않게 한다. */
  private long saveTagged(String description) {
    return repository.save(
        null, "system", "CREATE", "issue", "1", description, null, null, "SUCCESS", null, null);
  }

  @Test
  void actionTime_isUtcWallClock_evenWhenSessionTimeZoneIsSeoul() {
    // SET LOCAL — 이 트랜잭션에서만(롤백 때 되돌아가 풀 커넥션의 다른 테스트로 새지 않는다).
    dsl.execute("SET LOCAL TIME ZONE 'Asia/Seoul'");
    String tag = "wp938-" + UUID.randomUUID();
    saveTagged(tag);

    AuditLogResponse saved =
        repository.findAll(tag, null, null, null, null, null, null, 0, 1).content().getFirst();
    // 서울 벽시계(UTC+9)였다면 9시간 차이 — UTC now 와 1분 안이어야 한다.
    assertThat(saved.actionTime())
        .isCloseTo(LocalDateTime.now(ZoneOffset.UTC), within(1, ChronoUnit.MINUTES));
  }

  @Test
  void periodFilter_kstDayAsUtcInstants_includesOnlyThatDay() {
    // 웹이 보내는 KST 2026-10-24 하루 = UTC 10-23T15:00 ~ 10-24T14:59:59.999 (AuditLogControllerTest 의 바인딩
    // 검증과 짝).
    String tag = "wp938-range-" + UUID.randomUUID();
    long inside = saveTagged(tag + " inside");
    long before = saveTagged(tag + " before");
    setActionTime(inside, LocalDateTime.of(2026, 10, 23, 15, 0)); // KST 10-24 00:00
    setActionTime(before, LocalDateTime.of(2026, 10, 23, 14, 59, 59)); // KST 10-23 23:59:59

    var page =
        repository.findAll(
            tag,
            null,
            null,
            null,
            null,
            LocalDateTime.of(2026, 10, 23, 15, 0),
            LocalDateTime.of(2026, 10, 24, 14, 59, 59, 999_000_000),
            0,
            10);

    assertThat(page.content()).extracting(AuditLogResponse::id).containsExactly(inside);
  }

  private void setActionTime(long id, LocalDateTime at) {
    dsl.update(table(name("audit_log")))
        .set(field(name("action_time"), LocalDateTime.class), at)
        .where(field(name("id"), Long.class).eq(id))
        .execute();
  }
}
