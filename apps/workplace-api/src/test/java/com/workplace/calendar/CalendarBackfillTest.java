package com.workplace.calendar;

import static com.workplace.jooq.Tables.CALENDAR;
import static com.workplace.jooq.Tables.CALENDAR_EVENT;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.support.IntegrationTestBase;
import java.time.OffsetDateTime;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/** V103 백필 불변식: owner 당 기본 캘린더 1개 + 신규 일정 calendar_id 수동 지정 시 보존. */
@Transactional
class CalendarBackfillTest extends IntegrationTestBase {
  @Autowired DSLContext dsl;

  private long user() {
    String t = UUID.randomUUID().toString().replace("-", "").substring(0, 8);
    return dsl.insertInto(USER)
        .set(USER.USERNAME, "bf_" + t)
        .set(USER.PASSWORD, "pw")
        .set(USER.NAME, "U " + t)
        .set(USER.EMAIL, t + "@example.com")
        .set(USER.KIND, "HUMAN")
        .returning(USER.ID)
        .fetchOne()
        .getId();
  }

  /** 기본 캘린더를 만들고 일정을 그 캘린더에 넣으면 calendar_id 가 보존된다(파셜 유니크 인덱스 동작 확인). */
  @Test
  void default_calendar_unique_per_owner() {
    long u = user();
    long calId =
        dsl.insertInto(CALENDAR)
            .set(CALENDAR.OWNER_ID, u)
            .set(CALENDAR.NAME, "기본")
            .set(CALENDAR.COLOR, "blue")
            .set(CALENDAR.IS_DEFAULT, true)
            .returning(CALENDAR.ID)
            .fetchOne()
            .getId();
    long evId =
        dsl.insertInto(CALENDAR_EVENT)
            .set(CALENDAR_EVENT.OWNER_ID, u)
            .set(CALENDAR_EVENT.TITLE, "e")
            .set(CALENDAR_EVENT.STARTS_AT, OffsetDateTime.parse("2026-06-10T09:00:00Z"))
            .set(CALENDAR_EVENT.ENDS_AT, OffsetDateTime.parse("2026-06-10T10:00:00Z"))
            .set(CALENDAR_EVENT.CALENDAR_ID, calId)
            .returning(CALENDAR_EVENT.ID)
            .fetchOne()
            .getId();

    Long stored =
        dsl.select(CALENDAR_EVENT.CALENDAR_ID)
            .from(CALENDAR_EVENT)
            .where(CALENDAR_EVENT.ID.eq(evId))
            .fetchOne(CALENDAR_EVENT.CALENDAR_ID);
    assertThat(stored).isEqualTo(calId);
    Integer defaults =
        dsl.selectCount()
            .from(CALENDAR)
            .where(CALENDAR.OWNER_ID.eq(u))
            .and(CALENDAR.IS_DEFAULT.isTrue())
            .fetchOne(0, Integer.class);
    assertThat(defaults).isEqualTo(1);
  }
}
