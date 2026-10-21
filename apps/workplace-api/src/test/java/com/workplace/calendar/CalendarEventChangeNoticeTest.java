package com.workplace.calendar;

import static com.workplace.jooq.Tables.CALENDAR_EVENT;
import static com.workplace.jooq.Tables.EVENT_ATTENDEE;
import static com.workplace.jooq.Tables.NOTIFICATION;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.awaitility.Awaitility.await;

import com.workplace.calendar.dto.CalendarEventRequest;
import com.workplace.calendar.dto.EditScope;
import com.workplace.calendar.service.CalendarEventService;
import com.workplace.global.tenant.TenantContext;
import com.workplace.notify.dto.NotificationResponse;
import com.workplace.notify.service.NotificationService;
import com.workplace.support.IntegrationTestBase;
import java.time.Duration;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

/**
 * 주최자의 일정 변경·취소를 참석자에게 알리는지(WP-712, A안) — 시간·장소가 바뀌면 「일정 변경」, 지우면 「일정 취소」, 시간이 바뀌면 응답을 「응답 필요」로
 * 되돌린다. 제목·설명·색만 바뀌면 알리지 않는다. 알림은 AFTER_COMMIT 비동기라 @Transactional 없이 커밋하고 정리한다.
 */
@DisplayName("일정 변경·취소 참석자 알림(WP-712)")
class CalendarEventChangeNoticeTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired CalendarEventService service;
  @Autowired NotificationService notificationService;

  private final List<Long> createdUserIds = new ArrayList<>();

  private static final OffsetDateTime NOW = OffsetDateTime.parse("2026-07-01T09:00:00Z");

  @BeforeEach
  void setTenant() {
    TenantContext.set(1L);
  }

  @AfterEach
  void cleanup() {
    TenantContext.clear();
    if (createdUserIds.isEmpty()) return;
    // 취소 알림은 event_id 가 없어 일정 삭제의 cascade 로 지워지지 않는다 — 받은 사람 기준으로 먼저 지운다.
    dsl.deleteFrom(NOTIFICATION).where(NOTIFICATION.RECIPIENT_ID.in(createdUserIds)).execute();
    dsl.deleteFrom(CALENDAR_EVENT).where(CALENDAR_EVENT.OWNER_ID.in(createdUserIds)).execute();
    dsl.deleteFrom(USER).where(USER.ID.in(createdUserIds)).execute();
    createdUserIds.clear();
  }

  private long seedUser(String prefix, String kind) {
    String t = UUID.randomUUID().toString().replace("-", "").substring(0, 8);
    long id =
        withMembership(
            dsl.insertInto(USER)
                .set(USER.USERNAME, prefix + "_" + t)
                .set(USER.PASSWORD, "pw")
                .set(USER.NAME, prefix + " " + t)
                .set(USER.EMAIL, prefix + "_" + t + "@example.com")
                .set(USER.KIND, kind)
                .returning(USER.ID)
                .fetchOne()
                .getId());
    createdUserIds.add(id);
    return id;
  }

  private static CalendarEventRequest req(
      String title,
      OffsetDateTime s,
      OffsetDateTime e,
      String location,
      String rrule,
      List<Long> attendees) {
    return new CalendarEventRequest(
        title, null, s, e, false, location, null, null, rrule, attendees, null);
  }

  private String rsvp(long eventId, long userId) {
    return dsl.select(EVENT_ATTENDEE.RSVP_STATUS)
        .from(EVENT_ATTENDEE)
        .where(EVENT_ATTENDEE.EVENT_ID.eq(eventId))
        .and(EVENT_ATTENDEE.USER_ID.eq(userId))
        .fetchOne(EVENT_ATTENDEE.RSVP_STATUS);
  }

  private int notifs(long recipientId, String type) {
    return dsl.fetchCount(
        NOTIFICATION, NOTIFICATION.RECIPIENT_ID.eq(recipientId).and(NOTIFICATION.TYPE.eq(type)));
  }

  /** 비동기 알림이 「오지 않음」을 확인하기 전 충분히 기다린다(오는 경우는 await 로 확인). */
  private static void settle() throws InterruptedException {
    Thread.sleep(700);
  }

  @Test
  @DisplayName("시간을 바꾸면 참석자에게 「일정 변경」이 가고 응답이 「응답 필요」로 돌아간다 — 주최자·AI 는 받지 않고 AI 응답은 그대로")
  void 시간_변경() throws Exception {
    long org = seedUser("org", "HUMAN");
    long guest = seedUser("g", "HUMAN");
    long agent = seedUser("ai", "AGENT");
    long id =
        service
            .create(org, req("주간 회의", NOW, NOW.plusHours(1), null, null, List.of(guest, agent)))
            .id();
    service.respondRsvp(guest, id, "ACCEPTED");

    service.update(
        org,
        id,
        req("주간 회의", NOW.plusHours(2), NOW.plusHours(3), null, null, null),
        EditScope.ALL,
        null);

    await()
        .atMost(Duration.ofSeconds(5))
        .untilAsserted(() -> assertThat(notifs(guest, "CALENDAR_EVENT_UPDATED")).isEqualTo(1));
    assertThat(rsvp(id, guest)).isEqualTo("NEEDS_ACTION");
    assertThat(rsvp(id, agent)).isEqualTo("ACCEPTED");
    assertThat(rsvp(id, org)).isEqualTo("ACCEPTED");
    settle();
    assertThat(notifs(org, "CALENDAR_EVENT_UPDATED")).isZero();
    assertThat(notifs(agent, "CALENDAR_EVENT_UPDATED")).isZero();
    // 인박스에는 바뀐 시각이 보인다.
    NotificationResponse n = notificationService.listRecent(guest, 20, 0).get(0);
    assertThat(n.type()).isEqualTo("CALENDAR_EVENT_UPDATED");
    assertThat(n.eventId()).isEqualTo(id);
    assertThat(n.eventStartsAt()).isEqualTo(NOW.plusHours(2).toInstant());
  }

  @Test
  @DisplayName("장소만 바꾸면 알리되 응답은 그대로 둔다")
  void 장소만_변경() throws Exception {
    long org = seedUser("org", "HUMAN");
    long guest = seedUser("g", "HUMAN");
    long id =
        service.create(org, req("1:1", NOW, NOW.plusHours(1), "3층 회의실", null, List.of(guest))).id();
    service.respondRsvp(guest, id, "ACCEPTED");

    service.update(
        org, id, req("1:1", NOW, NOW.plusHours(1), "5층 회의실", null, null), EditScope.ALL, null);

    await()
        .atMost(Duration.ofSeconds(5))
        .untilAsserted(() -> assertThat(notifs(guest, "CALENDAR_EVENT_UPDATED")).isEqualTo(1));
    assertThat(rsvp(id, guest)).isEqualTo("ACCEPTED");
  }

  @Test
  @DisplayName("제목만 바꾸면 — 같은 시각을 다른 오프셋(+09:00)으로 보내도 — 알리지 않고 응답도 그대로")
  void 제목만_변경() throws Exception {
    long org = seedUser("org", "HUMAN");
    long guest = seedUser("g", "HUMAN");
    long id =
        service.create(org, req("기획 회의", NOW, NOW.plusHours(1), " ", null, List.of(guest))).id();
    service.respondRsvp(guest, id, "ACCEPTED");

    ZoneOffset kst = ZoneOffset.ofHours(9);
    service.update(
        org,
        id,
        req(
            "기획 회의(최종)",
            NOW.withOffsetSameInstant(kst),
            NOW.plusHours(1).withOffsetSameInstant(kst),
            null,
            null,
            null),
        EditScope.ALL,
        null);

    settle();
    assertThat(notifs(guest, "CALENDAR_EVENT_UPDATED")).isZero();
    assertThat(rsvp(id, guest)).isEqualTo("ACCEPTED");
  }

  @Test
  @DisplayName("일정을 지우면 참석자에게 「일정 취소」가 가고, 일정이 사라진 뒤에도 인박스에 제목·원래 시각이 남는다")
  void 삭제() throws Exception {
    long org = seedUser("org", "HUMAN");
    long guest = seedUser("g", "HUMAN");
    long id =
        service.create(org, req("분기 리뷰", NOW, NOW.plusHours(1), null, null, List.of(guest))).id();

    service.delete(org, id, EditScope.ALL, null);

    await()
        .atMost(Duration.ofSeconds(5))
        .untilAsserted(() -> assertThat(notifs(guest, "CALENDAR_EVENT_CANCELED")).isEqualTo(1));
    NotificationResponse n = notificationService.listRecent(guest, 20, 0).get(0);
    assertThat(n.type()).isEqualTo("CALENDAR_EVENT_CANCELED");
    assertThat(n.eventId()).isNull();
    assertThat(n.eventTitle()).isEqualTo("분기 리뷰");
    assertThat(n.eventStartsAt()).isEqualTo(NOW.toInstant());
    settle();
    assertThat(notifs(org, "CALENDAR_EVENT_CANCELED")).isZero();
  }

  @Test
  @DisplayName("반복 일정의 한 회차 시간만 바꾸면 그 회차에만 응답 초기화·알림 — 시리즈의 응답은 그대로")
  void 반복_한_회차_변경() throws Exception {
    long org = seedUser("org", "HUMAN");
    long guest = seedUser("g", "HUMAN");
    long masterId =
        service
            .create(org, req("스탠드업", NOW, NOW.plusMinutes(15), null, "FREQ=DAILY", List.of(guest)))
            .id();
    service.respondRsvp(guest, masterId, "ACCEPTED");

    OffsetDateTime occ2 = NOW.plusDays(1);
    long overrideId =
        service
            .update(
                org,
                masterId,
                req("스탠드업", occ2.plusHours(1), occ2.plusHours(1).plusMinutes(15), null, null, null),
                EditScope.THIS,
                occ2)
            .id();

    await()
        .atMost(Duration.ofSeconds(5))
        .untilAsserted(() -> assertThat(notifs(guest, "CALENDAR_EVENT_UPDATED")).isEqualTo(1));
    assertThat(rsvp(overrideId, guest)).isEqualTo("NEEDS_ACTION");
    assertThat(rsvp(masterId, guest)).isEqualTo("ACCEPTED");
  }

  @Test
  @DisplayName("반복 일정의 한 회차를 지우면 「일정 취소」에 그 회차의 원래 시각이 보인다")
  void 반복_한_회차_삭제() throws Exception {
    long org = seedUser("org", "HUMAN");
    long guest = seedUser("g", "HUMAN");
    long masterId =
        service
            .create(org, req("스탠드업", NOW, NOW.plusMinutes(15), null, "FREQ=DAILY", List.of(guest)))
            .id();

    OffsetDateTime occ3 = NOW.plusDays(2);
    service.delete(org, masterId, EditScope.THIS, occ3);

    await()
        .atMost(Duration.ofSeconds(5))
        .untilAsserted(() -> assertThat(notifs(guest, "CALENDAR_EVENT_CANCELED")).isEqualTo(1));
    NotificationResponse n = notificationService.listRecent(guest, 20, 0).get(0);
    assertThat(n.eventTitle()).isEqualTo("스탠드업");
    assertThat(n.eventStartsAt()).isEqualTo(occ3.toInstant());
  }
}
