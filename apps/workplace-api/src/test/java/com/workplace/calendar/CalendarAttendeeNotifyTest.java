package com.workplace.calendar;

import static com.workplace.jooq.Tables.CALENDAR_EVENT;
import static com.workplace.jooq.Tables.NOTIFICATION;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.awaitility.Awaitility.await;

import com.workplace.calendar.dto.CalendarEventRequest;
import com.workplace.calendar.service.CalendarEventService;
import com.workplace.support.IntegrationTestBase;
import java.time.Duration;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

/**
 * 참석자 초대 및 RSVP 변경 시 알림이 생성되는지 통합 검증. AFTER_COMMIT 이벤트를 경유하므로 @Transactional 미사용 — 외부 트랜잭션 내에서는
 * AFTER_COMMIT 이 발화하지 않아 검증이 무력화된다.
 */
@DisplayName("캘린더 초대/RSVP 알림 통합")
class CalendarAttendeeNotifyTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired CalendarEventService service;

  private final List<Long> createdEventIds = new ArrayList<>();
  private final List<Long> createdUserIds = new ArrayList<>();

  private static final OffsetDateTime NOW = OffsetDateTime.parse("2026-07-01T09:00:00Z");

  @AfterEach
  void cleanup() {
    // calendar_event 삭제 → event_attendee, notification(event_id FK ON DELETE CASCADE) 동반 삭제.
    if (!createdEventIds.isEmpty()) {
      dsl.deleteFrom(CALENDAR_EVENT).where(CALENDAR_EVENT.ID.in(createdEventIds)).execute();
    }
    if (!createdUserIds.isEmpty()) {
      dsl.deleteFrom(USER).where(USER.ID.in(createdUserIds)).execute();
    }
    createdEventIds.clear();
    createdUserIds.clear();
  }

  /** 테스트용 HUMAN 사용자 시드 후 ID 반환. */
  private long seedUser(String prefix) {
    String t = UUID.randomUUID().toString().replace("-", "").substring(0, 8);
    long id =
        dsl.insertInto(USER)
            .set(USER.USERNAME, prefix + "_" + t)
            .set(USER.PASSWORD, "pw")
            .set(USER.NAME, prefix + " " + t)
            .set(USER.EMAIL, prefix + "_" + t + "@example.com")
            .set(USER.KIND, "HUMAN")
            .returning(USER.ID)
            .fetchOne()
            .getId();
    createdUserIds.add(id);
    return id;
  }

  /** 테스트용 AGENT 사용자 시드 후 ID 반환. */
  private long seedAgent(String prefix) {
    String t = UUID.randomUUID().toString().replace("-", "").substring(0, 8);
    long id =
        dsl.insertInto(USER)
            .set(USER.USERNAME, prefix + "_" + t)
            .set(USER.PASSWORD, "pw")
            .set(USER.NAME, prefix + " " + t)
            .set(USER.EMAIL, prefix + "_" + t + "@example.com")
            .set(USER.KIND, "AGENT")
            .returning(USER.ID)
            .fetchOne()
            .getId();
    createdUserIds.add(id);
    return id;
  }

  /** 일정 요청 헬퍼. */
  private CalendarEventRequest newReq(
      String title, OffsetDateTime s, OffsetDateTime e, List<Long> attendees) {
    return new CalendarEventRequest(title, null, s, e, false, null, null, null, null, attendees);
  }

  /** notification 행 수 조회 헬퍼 — type 및 recipient/event 조건. */
  private int notifCount(long recipientId, long eventId, String type) {
    return dsl.fetchCount(
        NOTIFICATION,
        NOTIFICATION
            .RECIPIENT_ID
            .eq(recipientId)
            .and(NOTIFICATION.EVENT_ID.eq(eventId))
            .and(NOTIFICATION.TYPE.eq(type)));
  }

  @Test
  @DisplayName("일정 생성 시 HUMAN 초대자에게 CALENDAR_INVITED 알림이 생성된다")
  void create_invitesHuman_createsInvitedNotification() {
    long org = seedUser("org");
    long guest = seedUser("g");
    long eventId =
        service.create(org, newReq("미팅", NOW, NOW.plusHours(1), List.of(guest))).id();
    createdEventIds.add(eventId);

    // AFTER_COMMIT + @Async 비동기 알림 생성 대기
    await()
        .atMost(Duration.ofSeconds(3))
        .untilAsserted(() -> assertThat(notifCount(guest, eventId, "CALENDAR_INVITED")).isEqualTo(1));
  }

  @Test
  @DisplayName("AGENT 초대자에게는 CALENDAR_INVITED 알림이 생성되지 않는다")
  void create_invitesAgent_noNotification() throws Exception {
    long org = seedUser("org");
    long agent = seedAgent("agent");
    long eventId =
        service.create(org, newReq("미팅", NOW, NOW.plusHours(1), List.of(agent))).id();
    createdEventIds.add(eventId);

    // 비동기 처리 시간 충분히 대기 후 알림 없음 확인
    Thread.sleep(500);
    assertThat(notifCount(agent, eventId, "CALENDAR_INVITED")).isEqualTo(0);
  }

  @Test
  @DisplayName("inviteAttendees() 시 HUMAN 초대자에게 CALENDAR_INVITED 알림이 생성된다")
  void inviteAttendees_createsInvitedNotification() {
    long org = seedUser("org");
    long guest = seedUser("g");
    long eventId =
        service.create(org, newReq("미팅", NOW, NOW.plusHours(1), List.of())).id();
    createdEventIds.add(eventId);

    service.inviteAttendees(org, eventId, List.of(guest));

    await()
        .atMost(Duration.ofSeconds(3))
        .untilAsserted(() -> assertThat(notifCount(guest, eventId, "CALENDAR_INVITED")).isEqualTo(1));
  }

  @Test
  @DisplayName("RSVP 변경 시 주최자에게 CALENDAR_RSVP_CHANGED 알림이 생성된다")
  void rsvp_notifiesOrganizer() {
    long org = seedUser("org");
    long guest = seedUser("g");
    long eventId =
        service.create(org, newReq("미팅", NOW, NOW.plusHours(1), List.of(guest))).id();
    createdEventIds.add(eventId);

    service.respondRsvp(guest, eventId, "DECLINED");

    await()
        .atMost(Duration.ofSeconds(3))
        .untilAsserted(
            () -> assertThat(notifCount(org, eventId, "CALENDAR_RSVP_CHANGED")).isEqualTo(1));
  }

  @Test
  @DisplayName("주최자 본인 RSVP 변경 시 자기 자신에게 알림이 생성되지 않는다(self-notify 방지)")
  void rsvp_bySelf_noSelfNotification() throws Exception {
    long org = seedUser("org");
    long eventId =
        service.create(org, newReq("미팅", NOW, NOW.plusHours(1), List.of())).id();
    createdEventIds.add(eventId);

    // org 가 ORGANIZER/ACCEPTED 이므로 RSVP 갱신 — 행이 있으면 성공, 주최자=수신자 → self-notify 없음
    // (org 가 attendee 행이 있어야 respondRsvp 통과)
    // → 이미 ORGANIZER/ACCEPTED 이므로 ACCEPTED 로 RSVP 갱신
    service.respondRsvp(org, eventId, "ACCEPTED");

    Thread.sleep(500);
    // 주최자 == actor → self-notify 없음
    assertThat(notifCount(org, eventId, "CALENDAR_RSVP_CHANGED")).isEqualTo(0);
  }
}
