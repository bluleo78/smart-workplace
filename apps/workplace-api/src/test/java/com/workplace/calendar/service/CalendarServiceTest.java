package com.workplace.calendar.service;

import static com.workplace.jooq.Tables.CALENDAR_EVENT;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.calendar.dto.CalendarRequest;
import com.workplace.calendar.dto.CalendarResponse;
import com.workplace.calendar.exception.CalendarNotFoundException;
import com.workplace.calendar.exception.DefaultCalendarDeletionException;
import com.workplace.calendar.repository.CalendarRepository;
import com.workplace.support.IntegrationTestBase;
import java.time.OffsetDateTime;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/** CalendarService 통합 테스트 — 기본 캘린더 lazy 생성·색 검증·삭제 시맨틱·소유 검증. */
@Transactional
class CalendarServiceTest extends IntegrationTestBase {
  @Autowired DSLContext dsl;
  @Autowired CalendarService service;
  @Autowired CalendarRepository repo;

  private long user() {
    String t = UUID.randomUUID().toString().replace("-", "").substring(0, 8);
    return dsl.insertInto(USER)
        .set(USER.USERNAME, "cs_" + t)
        .set(USER.PASSWORD, "pw")
        .set(USER.NAME, "U " + t)
        .set(USER.EMAIL, t + "@example.com")
        .set(USER.KIND, "HUMAN")
        .returning(USER.ID)
        .fetchOne()
        .getId();
  }

  @Test
  void list_lazily_creates_default() {
    long u = user();
    var cals = service.list(u);
    assertThat(cals).hasSize(1);
    assertThat(cals.get(0).isDefault()).isTrue();
    assertThat(cals.get(0).color()).isEqualTo("blue");
  }

  @Test
  void create_rejects_invalid_color() {
    long u = user();
    assertThatThrownBy(() -> service.create(u, new CalendarRequest("X", "#ff0000", null)))
        .isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void delete_default_rejected() {
    long u = user();
    long def = service.ensureDefault(u);
    assertThatThrownBy(() -> service.delete(u, def))
        .isInstanceOf(DefaultCalendarDeletionException.class);
  }

  @Test
  void delete_nondefault_moves_events_to_default() {
    long u = user();
    long def = service.ensureDefault(u);
    CalendarResponse work = service.create(u, new CalendarRequest("업무", "red", null));
    long ev =
        dsl.insertInto(CALENDAR_EVENT)
            .set(CALENDAR_EVENT.OWNER_ID, u)
            .set(CALENDAR_EVENT.TITLE, "e")
            .set(CALENDAR_EVENT.STARTS_AT, OffsetDateTime.parse("2026-06-10T09:00:00Z"))
            .set(CALENDAR_EVENT.ENDS_AT, OffsetDateTime.parse("2026-06-10T10:00:00Z"))
            .set(CALENDAR_EVENT.CALENDAR_ID, work.id())
            .returning(CALENDAR_EVENT.ID)
            .fetchOne()
            .getId();

    service.delete(u, work.id());

    Long moved =
        dsl.select(CALENDAR_EVENT.CALENDAR_ID)
            .from(CALENDAR_EVENT)
            .where(CALENDAR_EVENT.ID.eq(ev))
            .fetchOne(CALENDAR_EVENT.CALENDAR_ID);
    assertThat(moved).isEqualTo(def);
    assertThat(repo.findByIdForOwner(u, work.id())).isEmpty();
  }

  @Test
  void update_other_owner_rejected() {
    long u1 = user();
    long u2 = user();
    CalendarResponse c = service.create(u1, new CalendarRequest("A", "blue", null));
    assertThatThrownBy(() -> service.update(u2, c.id(), new CalendarRequest("B", "red", null)))
        .isInstanceOf(CalendarNotFoundException.class);
  }
}
