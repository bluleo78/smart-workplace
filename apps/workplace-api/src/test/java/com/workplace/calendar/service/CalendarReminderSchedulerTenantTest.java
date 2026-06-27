package com.workplace.calendar.service;

import static com.workplace.jooq.Tables.CALENDAR;
import static com.workplace.jooq.Tables.CALENDAR_EVENT;
import static com.workplace.jooq.Tables.NOTIFICATION;
import static com.workplace.jooq.Tables.TENANT;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.awaitility.Awaitility.await;

import com.workplace.calendar.repository.EventReminderRepository;
import com.workplace.support.IntegrationTestBase;
import java.time.Duration;
import java.time.OffsetDateTime;
import java.time.temporal.ChronoUnit;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

/**
 * V59 이후 리마인더 스케줄러 per-tenant 순회 검증 — RLS 가 켜진 event_reminder/calendar_event/notification 에 대해
 * {@code poll()} 이 {@code TenantScopedRunner.forEachActiveTenant} 로 활성 테넌트마다 GUC 를 주입하며 돌아, 두 테넌트의
 * due 리마인더를 모두 발화하고 각 테넌트 컨텍스트에서 알림(notification)이 생성됨을 단언한다(캘린더 리마인더→알림 체인의 GUC 전파 검증).
 *
 * <p>@Transactional 절대 금지 — AFTER_COMMIT @Async 알림 핸들러는 커밋된 트랜잭션에서만 발화한다. 커밋된 시드를 추적해 @AfterEach 에서
 * calendar_event 삭제로 회수(event_reminder·notification 은 event_id FK ON DELETE CASCADE). 두 번째 테넌트는 고정
 * 슬러그 find-or-create 로 누적을 막는다(app_tenant 는 tenant DELETE 불가, V46).
 *
 * <p>시드/조회는 세션 GUC(app.tenant_id)를 대상 테넌트로 전환해 autocommit 으로 수행한다 — RLS 가 강제되는 app_tenant 롤이므로, 시드
 * INSERT 의 WITH CHECK 와 조회 USING 모두 해당 테넌트 GUC 하에서만 통과한다.
 */
@DisplayName("캘린더 리마인더 스케줄러 per-tenant 순회 → 양 테넌트 알림")
class CalendarReminderSchedulerTenantTest extends IntegrationTestBase {

  private static final String TENANT2_SLUG = "reminder-sched-tenant-2";

  @Autowired DSLContext dsl;
  @Autowired EventReminderRepository reminderRepo;
  @Autowired CalendarReminderScheduler scheduler;

  private Long t1EventId;
  private Long t2EventId;
  private Long t1Owner;
  private Long t2Owner;
  private long tid2;

  /** 세션 GUC 를 대상 테넌트로 전환(autocommit 시드/조회용, 트랜잭션 밖이므로 is_local=false). */
  private void setSessionGuc(long tenantId) {
    dsl.execute("SELECT set_config('app.tenant_id', '" + tenantId + "', false)");
  }

  /** 고정 슬러그로 두 번째 ACTIVE 테넌트를 find-or-create(커밋 상태). 생성/조회는 소유자가 보는 tenant 테이블(RLS 없음) 기준. */
  private long ensureSecondTenant() {
    Long existing =
        dsl.select(TENANT.ID).from(TENANT).where(TENANT.SLUG.eq(TENANT2_SLUG)).fetchOne(TENANT.ID);
    if (existing != null) {
      return existing;
    }
    return dsl.insertInto(TENANT)
        .set(TENANT.SLUG, TENANT2_SLUG)
        .set(TENANT.NAME, "Reminder Sched Tenant 2")
        .set(TENANT.STATUS, "ACTIVE")
        .returning(TENANT.ID)
        .fetchOne()
        .getId();
  }

  /** 현재 세션 GUC(=tenantId) 컨텍스트에 owner user 1명 생성. */
  private long seedOwner(long tenantId) {
    String t = UUID.randomUUID().toString().replace("-", "").substring(0, 8);
    return dsl.insertInto(USER)
        .set(USER.USERNAME, "rsched_" + t)
        .set(USER.PASSWORD, "pw")
        .set(USER.NAME, "U" + t)
        .set(USER.EMAIL, t + "@example.com")
        .set(USER.KIND, "HUMAN")
        .returning(USER.ID)
        .fetchOne()
        .getId();
  }

  /**
   * 현재 세션 GUC 컨텍스트에 due 리마인더(시작 2분 후, 10분 전 리마인더 → 발화시점 이미 지남) 시드. eventId 반환. V104 NOT NULL: 현재
   * GUC 컨텍스트에서 기본 캘린더를 직접 삽입 후 calendar_id 설정.
   */
  private long seedDueReminder(long ownerId) {
    long calId =
        dsl.insertInto(CALENDAR)
            .set(CALENDAR.OWNER_ID, ownerId)
            .set(CALENDAR.NAME, "기본")
            .set(CALENDAR.COLOR, "blue")
            .set(CALENDAR.IS_DEFAULT, true)
            .returning(CALENDAR.ID)
            .fetchOne()
            .getId();
    long eventId =
        dsl.insertInto(CALENDAR_EVENT)
            .set(CALENDAR_EVENT.OWNER_ID, ownerId)
            .set(CALENDAR_EVENT.TITLE, "테넌트 리마인더")
            .set(CALENDAR_EVENT.STARTS_AT, OffsetDateTime.now().plus(2, ChronoUnit.MINUTES))
            .set(CALENDAR_EVENT.ENDS_AT, OffsetDateTime.now().plus(62, ChronoUnit.MINUTES))
            .set(CALENDAR_EVENT.ALL_DAY, false)
            .set(CALENDAR_EVENT.CALENDAR_ID, calId)
            .returning(CALENDAR_EVENT.ID)
            .fetchOne()
            .getId();
    reminderRepo.upsert(eventId, 10);
    return eventId;
  }

  private int reminderNotifCount(long tenantGuc, long recipientId, long eventId) {
    setSessionGuc(tenantGuc);
    return dsl.fetchCount(
        NOTIFICATION,
        NOTIFICATION
            .RECIPIENT_ID
            .eq(recipientId)
            .and(NOTIFICATION.EVENT_ID.eq(eventId))
            .and(NOTIFICATION.TYPE.eq("REMINDER")));
  }

  @AfterEach
  void cleanup() {
    // 각 테넌트 컨텍스트에서 자기 calendar_event 삭제 → event_reminder/notification CASCADE 회수.
    if (t1EventId != null) {
      setSessionGuc(1L);
      dsl.deleteFrom(CALENDAR_EVENT).where(CALENDAR_EVENT.ID.eq(t1EventId)).execute();
      if (t1Owner != null) dsl.deleteFrom(USER).where(USER.ID.eq(t1Owner)).execute();
    }
    if (t2EventId != null) {
      setSessionGuc(tid2);
      dsl.deleteFrom(CALENDAR_EVENT).where(CALENDAR_EVENT.ID.eq(t2EventId)).execute();
      if (t2Owner != null) dsl.deleteFrom(USER).where(USER.ID.eq(t2Owner)).execute();
    }
    // 세션 GUC 를 하버스 기본값(1)으로 복원 — 후속 테스트 오염 방지.
    setSessionGuc(1L);
  }

  @Test
  @DisplayName("두 테넌트 due 리마인더 → poll() 1회 → 양쪽 모두 REMINDER 알림 생성")
  void poll_firesRemindersForAllTenants() {
    tid2 = ensureSecondTenant();

    // tenant#1 due 리마인더 시드
    setSessionGuc(1L);
    t1Owner = seedOwner(1L);
    t1EventId = seedDueReminder(t1Owner);

    // tenant#2 due 리마인더 시드(세션 GUC 를 tid2 로 전환)
    setSessionGuc(tid2);
    t2Owner = seedOwner(tid2);
    t2EventId = seedDueReminder(t2Owner);

    // 폴러 1회 — forEachActiveTenant 가 테넌트별 GUC 트랜잭션으로 양쪽을 처리.
    // (스케줄러 본체는 TenantContext 를 직접 박으므로, 호출 전 세션 GUC 상태와 무관하다.)
    scheduler.poll();

    final long fT1Owner = t1Owner;
    final long fT1EventId = t1EventId;
    final long fT2Owner = t2Owner;
    final long fT2EventId = t2EventId;
    // 비동기 알림 생성 대기 — 양 테넌트 모두 각자 컨텍스트에서 REMINDER 알림 1건.
    await()
        .atMost(Duration.ofSeconds(5))
        .untilAsserted(
            () -> {
              assertThat(reminderNotifCount(1L, fT1Owner, fT1EventId)).isEqualTo(1);
              assertThat(reminderNotifCount(tid2, fT2Owner, fT2EventId)).isEqualTo(1);
            });
  }
}
