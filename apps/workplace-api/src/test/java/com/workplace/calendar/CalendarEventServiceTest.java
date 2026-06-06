package com.workplace.calendar;

import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.calendar.dto.CalendarEventRequest;
import com.workplace.calendar.dto.CalendarEventResponse;
import com.workplace.calendar.exception.CalendarEventNotFoundException;
import com.workplace.calendar.service.CalendarEventService;
import com.workplace.support.IntegrationTestBase;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/** owner 격리(비-owner→404) 및 범위 겹침 조회 검증. 메서드 롤백 격리. */
@Transactional
class CalendarEventServiceTest extends IntegrationTestBase {
  @Autowired DSLContext dsl;
  @Autowired CalendarEventService service;

  private static final OffsetDateTime BASE = OffsetDateTime.parse("2026-06-10T09:00:00Z");

  /** 테스트용 사용자 삽입 후 ID 반환. */
  private long user() {
    String t = UUID.randomUUID().toString().replace("-", "").substring(0, 8);
    return dsl.insertInto(USER)
        .set(USER.USERNAME, "c_" + t)
        .set(USER.PASSWORD, "pw")
        .set(USER.NAME, "U " + t)
        .set(USER.EMAIL, t + "@example.com")
        .set(USER.KIND, "HUMAN")
        .returning(USER.ID)
        .fetchOne()
        .getId();
  }

  /** 일정 요청 헬퍼. */
  private CalendarEventRequest req(OffsetDateTime s, OffsetDateTime e) {
    return new CalendarEventRequest("회의", null, s, e, false, null, null);
  }

  @Test
  void create_then_get_roundtrip() {
    long u = user();
    CalendarEventResponse created = service.create(u, req(BASE, BASE.plusHours(1)));
    CalendarEventResponse fetched = service.get(u, created.id());

    assertThat(fetched.id()).isEqualTo(created.id());
    assertThat(fetched.title()).isEqualTo("회의");
    assertThat(fetched.startsAt()).isEqualTo(BASE);
  }

  @Test
  void get_byNonOwner_throws404() {
    long owner = user();
    long other = user();
    CalendarEventResponse created = service.create(owner, req(BASE, BASE.plusHours(1)));

    assertThatThrownBy(() -> service.get(other, created.id()))
        .isInstanceOf(CalendarEventNotFoundException.class);
  }

  @Test
  void update_byNonOwner_throws404() {
    long owner = user();
    long other = user();
    CalendarEventResponse created = service.create(owner, req(BASE, BASE.plusHours(1)));

    assertThatThrownBy(() -> service.update(other, created.id(), req(BASE, BASE.plusHours(2))))
        .isInstanceOf(CalendarEventNotFoundException.class);
  }

  @Test
  void delete_byNonOwner_throws404() {
    long owner = user();
    long other = user();
    CalendarEventResponse created = service.create(owner, req(BASE, BASE.plusHours(1)));

    assertThatThrownBy(() -> service.delete(other, created.id()))
        .isInstanceOf(CalendarEventNotFoundException.class);
  }

  @Test
  void list_returnsOnlyOverlappingOwnEvents() {
    long u = user();
    long other = user();

    // [BASE, BASE+1h] — 범위 안에 완전히 포함
    CalendarEventResponse inside = service.create(u, req(BASE, BASE.plusHours(1)));
    // [BASE-2h, BASE+30m] — 왼쪽 경계 겹침
    CalendarEventResponse edge = service.create(u, req(BASE.minusHours(2), BASE.plusMinutes(30)));
    // [BASE+5d, BASE+5d+1h] — 범위 밖
    service.create(u, req(BASE.plusDays(5), BASE.plusDays(5).plusHours(1)));
    // 다른 사용자의 겹치는 일정 — 목록에 포함되면 안 됨
    service.create(other, req(BASE, BASE.plusHours(1)));

    // 쿼리 범위: [BASE-1h, BASE+2h)
    List<CalendarEventResponse> result = service.list(u, BASE.minusHours(1), BASE.plusHours(2));

    assertThat(result)
        .extracting(CalendarEventResponse::id)
        .containsExactlyInAnyOrder(inside.id(), edge.id());
  }
}
