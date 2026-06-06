package com.workplace.calendar.integration;

import static com.workplace.jooq.Tables.CALENDAR_EVENT;
import static com.workplace.jooq.Tables.NOTIFICATION;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.awaitility.Awaitility.await;

import com.workplace.calendar.repository.EventReminderRepository;
import com.workplace.calendar.service.CalendarReminderScheduler;
import com.workplace.support.IntegrationTestBase;
import java.time.OffsetDateTime;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

/**
 * 리마인더 발화 전체 경로 통합 — 폴러(@Scheduled @Transactional) → CalendarReminderDueEvent → notify
 * dispatcher(AFTER_COMMIT, @Async) → notification 인박스 행 생성. 스펙의 "폴링·이벤트" 통합 기준.
 *
 * <p>이 클래스는 @Transactional 을 절대 붙이지 않는다 — 외부 트랜잭션 안에서는 AFTER_COMMIT 이 발화하지 않아 검증이 무력화된다. 커밋된 row 를
 * 추적해 @AfterEach 에서 회수(calendar_event 삭제 시 event_reminder·notification 은 FK CASCADE).
 */
@DisplayName("캘린더 리마인더 발화 → notify 인박스 통합")
class CalendarReminderNotifyIntegrationTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired EventReminderRepository reminderRepo;
  @Autowired CalendarReminderScheduler scheduler;

  private final List<Long> createdEventIds = new ArrayList<>();
  private final List<Long> createdUserIds = new ArrayList<>();

  @AfterEach
  void cleanup() {
    // calendar_event 삭제 → event_reminder, notification(event_id FK ON DELETE CASCADE) 동반 삭제.
    if (!createdEventIds.isEmpty()) {
      dsl.deleteFrom(CALENDAR_EVENT).where(CALENDAR_EVENT.ID.in(createdEventIds)).execute();
    }
    if (!createdUserIds.isEmpty()) {
      dsl.deleteFrom(USER).where(USER.ID.in(createdUserIds)).execute();
    }
    createdEventIds.clear();
    createdUserIds.clear();
  }

  private long user() {
    String t = UUID.randomUUID().toString().replace("-", "").substring(0, 8);
    long id =
        dsl.insertInto(USER)
            .set(USER.USERNAME, "ri_" + t)
            .set(USER.PASSWORD, "pw")
            .set(USER.NAME, "U" + t)
            .set(USER.EMAIL, t + "@example.com")
            .set(USER.KIND, "HUMAN")
            .returning(USER.ID)
            .fetchOne()
            .getId();
    createdUserIds.add(id);
    return id;
  }

  private long event(long ownerId, OffsetDateTime startsAt) {
    long id =
        dsl.insertInto(CALENDAR_EVENT)
            .set(CALENDAR_EVENT.OWNER_ID, ownerId)
            .set(CALENDAR_EVENT.TITLE, "발표")
            .set(CALENDAR_EVENT.STARTS_AT, startsAt)
            .set(CALENDAR_EVENT.ENDS_AT, startsAt.plusHours(1))
            .set(CALENDAR_EVENT.ALL_DAY, false)
            .returning(CALENDAR_EVENT.ID)
            .fetchOne()
            .getId();
    createdEventIds.add(id);
    return id;
  }

  private int reminderNotifCount(long recipientId, long eventId) {
    return dsl.fetchCount(
        NOTIFICATION,
        NOTIFICATION
            .RECIPIENT_ID
            .eq(recipientId)
            .and(NOTIFICATION.EVENT_ID.eq(eventId))
            .and(NOTIFICATION.TYPE.eq("REMINDER")));
  }

  @Test
  @DisplayName("발화 시점 도달한 리마인더 → poll → 소유자 인박스에 REMINDER 알림 1건")
  void due_reminder_poll_creates_inbox_notification() {
    long owner = user();
    // 시작 2분 후, 10분 전 리마인더 → 발화 시점(now-8분) 이미 지남 = due
    long eventId = event(owner, OffsetDateTime.now().plus(2, ChronoUnit.MINUTES));
    reminderRepo.upsert(eventId, 10);

    // 폴러 직접 실행(프록시 경유 @Transactional) → 커밋 후 AFTER_COMMIT @Async dispatcher 발화
    scheduler.poll();

    // 비동기 알림 생성 대기 — 전체 경로(폴러→이벤트→notify→인박스 row) 검증
    await()
        .atMost(java.time.Duration.ofSeconds(3))
        .untilAsserted(() -> assertThat(reminderNotifCount(owner, eventId)).isEqualTo(1));

    // 발화 후 fired_at 마킹 → 재폴링해도 중복 생성 없음
    scheduler.poll();
    assertThat(reminderNotifCount(owner, eventId)).isEqualTo(1);
  }
}
