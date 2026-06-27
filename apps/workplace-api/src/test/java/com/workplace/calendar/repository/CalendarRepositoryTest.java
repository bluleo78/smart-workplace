package com.workplace.calendar.repository;

import static com.workplace.jooq.Tables.CALENDAR_EVENT;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.calendar.dto.CalendarResponse;
import com.workplace.support.IntegrationTestBase;
import java.time.OffsetDateTime;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

@Transactional
class CalendarRepositoryTest extends IntegrationTestBase {
  @Autowired DSLContext dsl;
  @Autowired CalendarRepository repo;

  private long user() {
    String t = UUID.randomUUID().toString().replace("-", "").substring(0, 8);
    return dsl.insertInto(USER)
        .set(USER.USERNAME, "cr_" + t)
        .set(USER.PASSWORD, "pw")
        .set(USER.NAME, "U " + t)
        .set(USER.EMAIL, t + "@example.com")
        .set(USER.KIND, "HUMAN")
        .returning(USER.ID)
        .fetchOne()
        .getId();
  }

  @Test
  void insert_list_update_roundtrip() {
    long u = user();
    long id = repo.insert(u, "운동", "green", false, 0);
    repo.update(id, "헬스", "teal", 2);
    CalendarResponse c = repo.findByIdForOwner(u, id).orElseThrow();
    assertThat(c.name()).isEqualTo("헬스");
    assertThat(c.color()).isEqualTo("teal");
    assertThat(c.position()).isEqualTo(2);
    assertThat(repo.listByOwner(u)).hasSize(1);
  }

  @Test
  void moveEvents_repoints_calendar_id() {
    long u = user();
    long from = repo.insert(u, "A", "blue", false, 0);
    long to = repo.insert(u, "B", "red", false, 1);
    long ev =
        dsl.insertInto(CALENDAR_EVENT)
            .set(CALENDAR_EVENT.OWNER_ID, u)
            .set(CALENDAR_EVENT.TITLE, "e")
            .set(CALENDAR_EVENT.STARTS_AT, OffsetDateTime.parse("2026-06-10T09:00:00Z"))
            .set(CALENDAR_EVENT.ENDS_AT, OffsetDateTime.parse("2026-06-10T10:00:00Z"))
            .set(CALENDAR_EVENT.CALENDAR_ID, from)
            .returning(CALENDAR_EVENT.ID)
            .fetchOne()
            .getId();

    repo.moveEventsToCalendar(from, to);

    Long now =
        dsl.select(CALENDAR_EVENT.CALENDAR_ID)
            .from(CALENDAR_EVENT)
            .where(CALENDAR_EVENT.ID.eq(ev))
            .fetchOne(CALENDAR_EVENT.CALENDAR_ID);
    assertThat(now).isEqualTo(to);
  }
}
