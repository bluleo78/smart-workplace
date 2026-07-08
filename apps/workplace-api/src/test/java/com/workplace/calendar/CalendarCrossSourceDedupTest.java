package com.workplace.calendar;

import static com.workplace.jooq.Tables.CALENDAR_EVENT;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.calendar.dto.CalendarEventRequest;
import com.workplace.calendar.dto.CalendarEventResponse;
import com.workplace.calendar.service.CalendarEventService;
import com.workplace.support.IntegrationTestBase;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/**
 * 크로스소스 중복 제거 통합 테스트 — 같은 iCalUId·시작시각의 "내 소유 동기화 사본"과 "초대 사본"이 함께 조회될 때 초대 사본만 제거되는지, 그리고 과잉 제거가
 * 없는지 검증. @Transactional 롤백 격리.
 */
@Transactional
class CalendarCrossSourceDedupTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired CalendarEventService service;

  private static final OffsetDateTime T = OffsetDateTime.parse("2026-07-01T09:00:00Z");

  private long seedUser(String prefix) {
    String t = UUID.randomUUID().toString().replace("-", "").substring(0, 8);
    return dsl.insertInto(USER)
        .set(USER.USERNAME, prefix + "_" + t)
        .set(USER.PASSWORD, "pw")
        .set(USER.NAME, prefix + " " + t)
        .set(USER.EMAIL, prefix + "_" + t + "@example.com")
        .set(USER.KIND, "HUMAN")
        .returning(USER.ID)
        .fetchOne()
        .getId();
  }

  private CalendarEventRequest req(OffsetDateTime s, List<Long> attendees) {
    return new CalendarEventRequest(
        "회의", null, s, s.plusHours(1), false, null, null, null, null, attendees, null);
  }

  /** 해당 이벤트에 iCalUId 를 직접 스탬프(동기화 사본 시뮬레이션). */
  private void stampIcalUid(long eventId, String uid) {
    dsl.update(CALENDAR_EVENT)
        .set(CALENDAR_EVENT.ICAL_UID, uid)
        .where(CALENDAR_EVENT.ID.eq(eventId))
        .execute();
  }

  private List<Long> listedIds(long viewer) {
    return service.list(viewer, T.minusDays(1), T.plusDays(1)).stream()
        .map(CalendarEventResponse::id)
        .toList();
  }

  /** ① 동일 iCalUId·시작시각의 소유 사본이 있으면 초대 사본은 제거된다. */
  @Test
  void ownedSyncedCopy_present_hidesInvitedCopy() {
    long me = seedUser("me");
    long org = seedUser("org");
    long invited = service.create(org, req(T, List.of(me))).id(); // org 소유 + me 참석자
    long owned = service.create(me, req(T, List.of())).id(); // me 소유
    stampIcalUid(invited, "UID-1");
    stampIcalUid(owned, "UID-1");

    assertThat(listedIds(me)).contains(owned).doesNotContain(invited);
  }

  /** ② 소유 사본이 없으면 초대 사본은 그대로 보존된다. */
  @Test
  void noOwnedCopy_keepsInvitedCopy() {
    long me = seedUser("me");
    long org = seedUser("org");
    long invited = service.create(org, req(T, List.of(me))).id();
    stampIcalUid(invited, "UID-1");

    assertThat(listedIds(me)).contains(invited);
  }

  /** ③ 같은 iCalUId 라도 시작시각이 다르면(반복 회차 유사) 제거하지 않는다. */
  @Test
  void sameUid_differentStart_notDeduped() {
    long me = seedUser("me");
    long org = seedUser("org");
    long ownedAtT = service.create(me, req(T, List.of())).id();
    long invitedAtT2 = service.create(org, req(T.plusHours(2), List.of(me))).id();
    stampIcalUid(ownedAtT, "UID-1");
    stampIcalUid(invitedAtT2, "UID-1"); // 동일 UID, 다른 시작시각

    // T2 그룹엔 소유 사본이 없으므로 초대 사본 보존
    assertThat(listedIds(me)).contains(ownedAtT).contains(invitedAtT2);
  }

  /** ④ iCalUId 가 NULL(순수 로컬)이면 dedup 무영향 — 둘 다 보존. */
  @Test
  void nullIcalUid_untouched() {
    long me = seedUser("me");
    long org = seedUser("org");
    long invited = service.create(org, req(T, List.of(me))).id();
    long owned = service.create(me, req(T, List.of())).id();
    // 스탬프하지 않음 → ical_uid NULL

    assertThat(listedIds(me)).contains(owned).contains(invited);
  }

  /** ⑤ 소유 동기화 사본을 삭제하면 초대 사본이 다시 노출된다(read-time 폴백). */
  @Test
  void deletingOwnedCopy_reexposesInvitedCopy() {
    long me = seedUser("me");
    long org = seedUser("org");
    long invited = service.create(org, req(T, List.of(me))).id();
    long owned = service.create(me, req(T, List.of())).id();
    stampIcalUid(invited, "UID-1");
    stampIcalUid(owned, "UID-1");
    // 삭제 전엔 초대 사본이 숨겨짐
    assertThat(listedIds(me)).doesNotContain(invited);

    dsl.deleteFrom(CALENDAR_EVENT).where(CALENDAR_EVENT.ID.eq(owned)).execute();

    assertThat(listedIds(me)).contains(invited);
  }
}
