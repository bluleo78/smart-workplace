package com.workplace.calendar;

import static com.workplace.jooq.Tables.CALENDAR;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.calendar.service.CalendarService;
import com.workplace.support.IntegrationTestBase;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/**
 * WP-2169 기본 캘린더 이름 「Works 캘린더」 — 새로 만드는 기본 캘린더의 이름과, V347 이 옛 이름 「기본」 을 바꾸는 범위(기본 캘린더이면서 이름이 「기본」
 * 인 행만)를 검증한다.
 */
@Transactional
class CalendarDefaultNameMigrationTest extends IntegrationTestBase {
  @Autowired DSLContext dsl;
  @Autowired CalendarService service;

  private long user() {
    String t = UUID.randomUUID().toString().replace("-", "").substring(0, 8);
    return dsl.insertInto(USER)
        .set(USER.USERNAME, "dn_" + t)
        .set(USER.PASSWORD, "pw")
        .set(USER.NAME, "U " + t)
        .set(USER.EMAIL, t + "@example.com")
        .set(USER.KIND, "HUMAN")
        .returning(USER.ID)
        .fetchOne()
        .getId();
  }

  /** 캘린더 한 행을 직접 넣고 id 를 돌려준다(기본 캘린더는 소유자당 하나라 소유자를 따로 만든다). */
  private long calendar(long owner, String name, boolean isDefault) {
    return dsl.insertInto(CALENDAR)
        .set(CALENDAR.OWNER_ID, owner)
        .set(CALENDAR.NAME, name)
        .set(CALENDAR.COLOR, "blue")
        .set(CALENDAR.IS_DEFAULT, isDefault)
        .returning(CALENDAR.ID)
        .fetchOne()
        .getId();
  }

  private String nameOf(long id) {
    return dsl.select(CALENDAR.NAME)
        .from(CALENDAR)
        .where(CALENDAR.ID.eq(id))
        .fetchOne(CALENDAR.NAME);
  }

  /** ensureDefault 가 새로 만드는 기본 캘린더 이름은 「Works 캘린더」 다. */
  @Test
  void ensureDefault_creates_works_calendar_name() {
    long u = user();
    long id = service.ensureDefault(u);
    assertThat(nameOf(id)).isEqualTo("Works 캘린더");
    assertThat(CalendarService.DEFAULT_CALENDAR_NAME).isEqualTo("Works 캘린더");
  }

  /** V347 의 UPDATE 와 같은 문 — 기본 캘린더이면서 이름이 「기본」 인 행만 바뀌고 나머지는 그대로다. */
  @Test
  void migration_renames_only_untouched_default_calendars() {
    long u1 = user();
    long u2 = user();
    long u3 = user();
    long untouched = calendar(u1, "기본", true);
    long renamedByUser = calendar(u2, "내 일정", true);
    long nonDefault = calendar(u3, "기본", false);

    dsl.execute(
        "UPDATE calendar SET name = 'Works 캘린더', updated_at = now() WHERE is_default = true AND name = '기본'");

    assertThat(nameOf(untouched)).isEqualTo("Works 캘린더");
    assertThat(nameOf(renamedByUser)).isEqualTo("내 일정");
    assertThat(nameOf(nonDefault)).isEqualTo("기본");
  }
}
