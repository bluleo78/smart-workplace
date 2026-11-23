package com.workplace.global.realtime.relay;

import static com.workplace.jooq.Tables.SSE_RELAY_EVENT;

import java.time.OffsetDateTime;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import net.javacrumbs.shedlock.spring.annotation.SchedulerLock;
import org.jooq.DSLContext;
import org.jooq.Field;
import org.jooq.impl.DSL;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * SSE 중계 아웃박스 정리(WP-1973) — {@code sse_relay_event} 행이 보존 시간({@link #RETENTION_MINUTES})을 넘기면 지운다.
 *
 * <p>행은 NOTIFY 통지({@code #id})로 파드마다 자기 수신 커넥션에서 되읽는다. 읽었다고 지우면 안 된다 — 파드마다 읽는 시점이 달라 아직 못 읽은 파드가
 * 행을 놓칠 수 있다(재생 버퍼 없음 — 재시도 상한 30초 백오프와 큰 여유를 둔 보존 시간이 그 보험이다). 그래서 정리는 「나이」 로만 판정한다.
 *
 * <p>테이블은 테넌트를 가로지르는 전역 행이라 RLS 가 없고(V326), runtime 롤({@code app_tenant})으로 직접 지운다 — 테넌트 순회가 필요 없는
 * 이유. 파드마다 회차가 겹쳐도 {@code @SchedulerLock} 이 하나만 돌게 한다(삭제는 멱등이라 겹쳐도 결과는 같지만, 회차마다 경고 로그가 중복되지 않게).
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class RelayOutboxCleaner {

  /** 보존 시간(분) — 이보다 어린 행은 다른 파드가 아직 못 읽었을 수 있어 건드리지 않는다(스펙 5.4). */
  static final int RETENTION_MINUTES = 10;

  /**
   * 정리 기준 시각 — 앱 시각이 아니라 DB 시계({@code now()})로 판정한다. 발행 파드가 찍은 {@code created_at} 과 같은 시계(모두 DB
   * 기본값)라 파드 간 시계 차이에 영향받지 않는다.
   */
  private static final Field<OffsetDateTime> OLDER_THAN_KEEP =
      DSL.field("now() - interval '" + RETENTION_MINUTES + " minutes'", OffsetDateTime.class);

  private final DSLContext dsl;

  /**
   * 기동 1분 뒤 첫 실행, 이후 직전 실행 종료 5분 뒤(스펙 5.4 — 5분마다). 잠금 이름은 작업마다 유일해야 한다 ({@code
   * ScheduledLockArchTest}).
   */
  @Scheduled(initialDelay = 60_000, fixedDelay = 300_000)
  @SchedulerLock(name = "SseRelayOutboxCleaner.scheduled")
  public void scheduled() {
    int deleted =
        dsl.deleteFrom(SSE_RELAY_EVENT)
            .where(SSE_RELAY_EVENT.CREATED_AT.lt(OLDER_THAN_KEEP))
            .execute();
    if (deleted > 0) {
      log.debug("SSE 중계 아웃박스 {}행 정리(보존 {}분)", deleted, RETENTION_MINUTES);
    }
  }
}
