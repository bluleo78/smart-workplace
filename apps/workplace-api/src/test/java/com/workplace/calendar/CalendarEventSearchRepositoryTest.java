package com.workplace.calendar;

import static com.workplace.calendar.CalendarSearchFixtures.insertAttendee;
import static com.workplace.calendar.CalendarSearchFixtures.insertCalendar;
import static com.workplace.calendar.CalendarSearchFixtures.insertEvent;
import static com.workplace.calendar.CalendarSearchFixtures.insertException;
import static com.workplace.calendar.CalendarSearchFixtures.insertExternal;
import static com.workplace.jooq.Tables.CALENDAR_EVENT;
import static com.workplace.jooq.Tables.EMAIL_ACCOUNT;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.calendar.repository.CalendarEventRepository;
import com.workplace.calendar.repository.CalendarEventRepository.CalendarEventSearchRow;
import com.workplace.global.tenant.TenantContext;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.time.OffsetDateTime;
import java.time.temporal.ChronoUnit;
import java.util.List;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/** 캘린더 일정 키워드 검색 저장소 쿼리(WP-1357) — 매칭 필드·와일드카드 이스케이프·가시성·cap. */
class CalendarEventSearchRepositoryTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired CalendarEventRepository repo;
  @Autowired PlatformTransactionManager txManager;

  private static final OffsetDateTime BASE = OffsetDateTime.parse("2026-06-10T09:00:00Z");

  /** 「지금」 기준 시각 — 시리즈 대표 회차·상한 정렬 판정에 넘긴다. */
  // DB(timestamptz)는 마이크로초까지만 저장한다 — 나노초가 남은 시각은 돌아온 값과 반올림만큼 어긋나 비교가 우연히 실패한다.
  private final OffsetDateTime now = OffsetDateTime.now().truncatedTo(ChronoUnit.MICROS);

  @BeforeEach
  void setUp() {
    TenantContext.set(1L);
  }

  @AfterEach
  void tearDown() {
    TenantContext.clear();
  }

  /** 트랜잭션 안에서 실행하고 항상 롤백해 다른 테스트에 데이터를 남기지 않는다. */
  private void inTx(Runnable body) {
    new TransactionTemplate(txManager)
        .executeWithoutResult(
            status -> {
              body.run();
              status.setRollbackOnly();
            });
  }

  @Test
  @DisplayName("제목_장소_참석자이름으로_찾는다")
  void 제목_장소_참석자이름으로_찾는다() {
    inTx(
        () -> {
          long me = TestFixtures.createHuman(dsl);
          long cal = insertCalendar(dsl, me, null);
          long other = TestFixtures.createHuman(dsl);
          dsl.update(USER).set(USER.NAME, "주간희").where(USER.ID.eq(other)).execute();
          long byTitle = insertEvent(dsl, me, cal, "주간 회의", null, BASE.plusDays(3));
          long byLocation = insertEvent(dsl, me, cal, "점심", "주간회의실", BASE.plusDays(2));
          long byAttendee = insertEvent(dsl, me, cal, "면담", null, BASE.plusDays(1));
          insertAttendee(dsl, byAttendee, other);

          List<CalendarEventSearchRow> rows = repo.searchCandidates(me, "주간", now, 10);

          assertThat(rows)
              .extracting(r -> r.event().id())
              .containsExactly(byTitle, byLocation, byAttendee);
          assertThat(rows)
              .extracting(CalendarEventSearchRow::matchedField)
              .containsExactly("TITLE", "LOCATION", "ATTENDEE");
          assertThat(rows)
              .extracting(CalendarEventSearchRow::matchedText)
              .containsExactly(null, "주간회의실", "주간희");
          assertThat(rows.get(0).event().calendarName()).isEqualTo("cal");
        });
  }

  @Test
  @DisplayName("외부참석자_이름_메일로도_찾는다")
  void 외부참석자_이름_메일로도_찾는다() {
    inTx(
        () -> {
          long me = TestFixtures.createHuman(dsl);
          long cal = insertCalendar(dsl, me, null);
          long byName = insertEvent(dsl, me, cal, "A", null, BASE.plusDays(2));
          long byMail = insertEvent(dsl, me, cal, "B", null, BASE.plusDays(1));
          insertExternal(dsl, byName, "홍길동", "x@ext.com");
          insertExternal(dsl, byMail, null, "zebra@ext.com");

          var nameRows = repo.searchCandidates(me, "길동", now, 10);
          assertThat(nameRows).extracting(r -> r.event().id()).containsExactly(byName);
          assertThat(nameRows.get(0).matchedText()).isEqualTo("홍길동");

          var mailRows = repo.searchCandidates(me, "ZEBRA", now, 10);
          assertThat(mailRows).extracting(r -> r.event().id()).containsExactly(byMail);
          assertThat(mailRows.get(0).matchedField()).isEqualTo("ATTENDEE");
          assertThat(mailRows.get(0).matchedText()).isEqualTo("zebra@ext.com");
        });
  }

  @Test
  @DisplayName("제목과_장소가_모두_맞으면_TITLE")
  void 제목과_장소가_모두_맞으면_TITLE() {
    inTx(
        () -> {
          long me = TestFixtures.createHuman(dsl);
          long cal = insertCalendar(dsl, me, null);
          insertEvent(dsl, me, cal, "주간 회의", "주간회의실", BASE);
          var rows = repo.searchCandidates(me, "주간", now, 10);
          assertThat(rows).hasSize(1);
          assertThat(rows.get(0).matchedField()).isEqualTo("TITLE");
          assertThat(rows.get(0).matchedText()).isNull();
        });
  }

  @Test
  @DisplayName("와일드카드는_글자그대로")
  void 와일드카드는_글자그대로() {
    inTx(
        () -> {
          long me = TestFixtures.createHuman(dsl);
          long cal = insertCalendar(dsl, me, null);
          long pct = insertEvent(dsl, me, cal, "100% 완료", null, BASE);
          insertEvent(dsl, me, cal, "1000 완료", null, BASE.plusDays(1));
          long under = insertEvent(dsl, me, cal, "a_b", null, BASE.plusDays(2));
          insertEvent(dsl, me, cal, "axb", null, BASE.plusDays(3));
          long bs = insertEvent(dsl, me, cal, "경로 c:\\dir", null, BASE.plusDays(4));

          assertThat(repo.searchCandidates(me, "0%", now, 10))
              .extracting(r -> r.event().id())
              .containsExactly(pct);
          assertThat(repo.searchCandidates(me, "_", now, 10))
              .extracting(r -> r.event().id())
              .containsExactly(under);
          assertThat(repo.searchCandidates(me, "\\", now, 10))
              .extracting(r -> r.event().id())
              .containsExactly(bs);
          // "%" 단독은 모든 글자에 맞는 와일드카드가 아니라 글자 '%' 가 든 제목만 찾는다
          assertThat(repo.searchCandidates(me, "%", now, 10))
              .extracting(r -> r.event().id())
              .containsExactly(pct);
        });
  }

  @Test
  @DisplayName("볼수없는_일정은_안나온다")
  void 볼수없는_일정은_안나온다() {
    inTx(
        () -> {
          long me = TestFixtures.createHuman(dsl);
          long other = TestFixtures.createHuman(dsl);
          long myCal = insertCalendar(dsl, me, null);
          long otherCal = insertCalendar(dsl, other, null);
          long disabledAcc = insertAccount(me);
          long disabledCal = insertCalendar(dsl, me, disabledAcc);
          long mine = insertEvent(dsl, me, myCal, "비밀 회의", null, BASE);
          insertEvent(dsl, other, otherCal, "비밀 남의", null, BASE);
          insertEvent(dsl, me, disabledCal, "비밀 끊김", null, BASE);
          // 초대받은 남의 일정은 보인다
          long invited = insertEvent(dsl, other, otherCal, "비밀 초대", null, BASE.plusDays(1));
          insertAttendee(dsl, invited, me);

          assertThat(repo.searchCandidates(me, "비밀", now, 10))
              .extracting(r -> r.event().id())
              .containsExactly(invited, mine);
        });
  }

  @Test
  @DisplayName("대소문자_무시")
  void 대소문자_무시() {
    inTx(
        () -> {
          long me = TestFixtures.createHuman(dsl);
          long cal = insertCalendar(dsl, me, null);
          long id = insertEvent(dsl, me, cal, "Weekly sync", null, BASE);
          assertThat(repo.searchCandidates(me, "weekly", now, 10))
              .extracting(r -> r.event().id())
              .containsExactly(id);
        });
  }

  @Test
  @DisplayName("cap 만큼만")
  void cap_만큼만() {
    inTx(
        () -> {
          long me = TestFixtures.createHuman(dsl);
          long cal = insertCalendar(dsl, me, null);
          for (int i = 0; i < 4; i++)
            insertEvent(dsl, me, cal, "스탠드업 " + i, null, BASE.plusDays(i));
          assertThat(repo.searchCandidates(me, "스탠드업", now, 2)).hasSize(2);
        });
  }

  @Test
  @DisplayName("이 회차만 고친 회차 행은 빼고 마스터 한 줄")
  void 고친_회차_행은_빠진다() {
    inTx(
        () -> {
          long me = TestFixtures.createHuman(dsl);
          long cal = insertCalendar(dsl, me, null);
          long master = insertEvent(dsl, me, cal, "주간 동기", null, now.minusWeeks(2));
          dsl.update(CALENDAR_EVENT)
              .set(CALENDAR_EVENT.RECURRENCE_RULE, "FREQ=WEEKLY")
              .where(CALENDAR_EVENT.ID.eq(master))
              .execute();
          // 다음 회차를 하루 옮긴 「이 회차만」 고친 행 + 그것을 가리키는 예외 행
          long override = insertEvent(dsl, me, cal, "주간 동기", null, now.plusWeeks(1).plusDays(1));
          insertException(dsl, master, now.minusWeeks(2).plusWeeks(3), false, override);

          assertThat(repo.searchCandidates(me, "동기", now, 10))
              .extracting(r -> r.event().id())
              .containsExactly(master);
        });
  }

  @Test
  @DisplayName("고친 회차만 검색어에 맞으면 그 고친 회차 행이 단일 일정처럼 나온다")
  void 고친_회차만_맞으면_그_행이_나온다() {
    inTx(
        () -> {
          long me = TestFixtures.createHuman(dsl);
          long cal = insertCalendar(dsl, me, null);
          long master = insertEvent(dsl, me, cal, "주간 회의", null, now.minusWeeks(2));
          dsl.update(CALENDAR_EVENT)
              .set(CALENDAR_EVENT.RECURRENCE_RULE, "FREQ=WEEKLY")
              .where(CALENDAR_EVENT.ID.eq(master))
              .execute();
          OffsetDateTime movedStart = now.plusWeeks(1).plusDays(1);
          long override = insertEvent(dsl, me, cal, "고객 데모", null, movedStart);
          insertException(dsl, master, now.minusWeeks(2).plusWeeks(3), false, override);

          var rows = repo.searchCandidates(me, "데모", now, 10);

          assertThat(rows).extracting(r -> r.event().id()).containsExactly(override);
          assertThat(rows.get(0).event().startsAt()).isEqualTo(movedStart);
          assertThat(rows.get(0).event().recurrenceRule()).isNull();
          assertThat(rows.get(0).matchedField()).isEqualTo("TITLE");
          // 마스터가 맞는 검색어는 마스터 한 줄만
          assertThat(repo.searchCandidates(me, "회의", now, 10))
              .extracting(r -> r.event().id())
              .containsExactly(master);
        });
  }

  @Test
  @DisplayName("상한이 작아도 끝난 반복 시리즈가 다가오는 단일 일정을 밀어내지 않는다")
  void 상한에서_반복_마스터가_다가오는_단일을_밀어내지_않는다() {
    inTx(
        () -> {
          long me = TestFixtures.createHuman(dsl);
          long cal = insertCalendar(dsl, me, null);
          for (int i = 0; i < 3; i++) {
            long m = insertEvent(dsl, me, cal, "정기 점검 " + i, null, now.minusYears(2 + i));
            dsl.update(CALENDAR_EVENT)
                .set(CALENDAR_EVENT.RECURRENCE_RULE, "FREQ=WEEKLY;COUNT=3")
                .where(CALENDAR_EVENT.ID.eq(m))
                .execute();
          }
          long tomorrow = insertEvent(dsl, me, cal, "정기 점검 내일", null, now.plusDays(1));

          assertThat(repo.searchCandidates(me, "정기 점검", now, 1))
              .extracting(r -> r.event().id())
              .containsExactly(tomorrow);
        });
  }

  @Test
  @DisplayName("내부 참석자의 메일 일부로도 찾는다")
  void 내부_참석자_메일로도_찾는다() {
    inTx(
        () -> {
          long me = TestFixtures.createHuman(dsl);
          long cal = insertCalendar(dsl, me, null);
          long other = TestFixtures.createHuman(dsl);
          dsl.update(USER)
              .set(USER.EMAIL, "quokka.unique@corp.test")
              .where(USER.ID.eq(other))
              .execute();
          long ev = insertEvent(dsl, me, cal, "면담", null, BASE);
          insertAttendee(dsl, ev, other);

          var rows = repo.searchCandidates(me, "quokka.unique", now, 10);

          assertThat(rows).extracting(r -> r.event().id()).containsExactly(ev);
          assertThat(rows.get(0).matchedField()).isEqualTo("ATTENDEE");
          assertThat(rows.get(0).matchedText()).isEqualTo("quokka.unique@corp.test");
        });
  }

  @Test
  @DisplayName("내 참석자 행은 참석자 맞음에서 빠진다")
  void 내_참석자_행은_참석자_맞음에서_빠진다() {
    inTx(
        () -> {
          long me = TestFixtures.createHuman(dsl);
          dsl.update(USER).set(USER.NAME, "김민수").where(USER.ID.eq(me)).execute();
          long other = TestFixtures.createHuman(dsl);
          dsl.update(USER).set(USER.NAME, "김민수철").where(USER.ID.eq(other)).execute();
          long cal = insertCalendar(dsl, me, null);
          long otherCal = insertCalendar(dsl, other, null);
          // 나만 참석자인 일정 — 내 이름으로는 안 나온다
          long onlyMe = insertEvent(dsl, other, otherCal, "내 일정", null, BASE);
          insertAttendee(dsl, onlyMe, me);
          // 다른 참석자 이름이 맞는 일정은 나온다
          long withOther = insertEvent(dsl, me, cal, "면담", null, BASE.plusDays(1));
          insertAttendee(dsl, withOther, other);

          var rows = repo.searchCandidates(me, "김민수", now, 10);

          assertThat(rows).extracting(r -> r.event().id()).containsExactly(withOther);
          assertThat(rows.get(0).matchedText()).isEqualTo("김민수철");
        });
  }

  @Test
  @DisplayName("M365 시리즈 회차 행은 시리즈당 한 줄 — 다가오는 가장 이른 회차, 없으면 가장 최근 회차")
  void M365_시리즈_회차는_한줄() {
    inTx(
        () -> {
          long me = TestFixtures.createHuman(dsl);
          long cal = insertCalendar(dsl, me, null);
          long pastOcc = insertEvent(dsl, me, cal, "M365 정례", null, now.minusDays(7));
          long nextOcc = insertEvent(dsl, me, cal, "M365 정례", null, now.plusDays(1));
          long laterOcc = insertEvent(dsl, me, cal, "M365 정례", null, now.plusDays(8));
          setSeries(List.of(pastOcc, nextOcc, laterOcc), "SM-UPCOMING");
          long endedOld = insertEvent(dsl, me, cal, "M365 정례", null, now.minusDays(14));
          long endedLast =
              insertEvent(dsl, me, cal, "M365 정례", null, now.minusDays(7).plusHours(2));
          setSeries(List.of(endedOld, endedLast), "SM-ENDED");

          assertThat(repo.searchCandidates(me, "정례", now, 10))
              .extracting(r -> r.event().id())
              .containsExactlyInAnyOrder(nextOcc, endedLast);
        });
  }

  @Test
  @DisplayName("상한은 다가오는 일정을 먼저 채운다")
  void 상한은_다가오는_일정_먼저() {
    inTx(
        () -> {
          long me = TestFixtures.createHuman(dsl);
          long cal = insertCalendar(dsl, me, null);
          insertEvent(dsl, me, cal, "상한 지난1", null, now.minusDays(1));
          insertEvent(dsl, me, cal, "상한 지난2", null, now.minusDays(2));
          long soon = insertEvent(dsl, me, cal, "상한 내일", null, now.plusDays(1));
          long later = insertEvent(dsl, me, cal, "상한 다음주", null, now.plusDays(7));
          insertEvent(dsl, me, cal, "상한 내년", null, now.plusDays(300));

          assertThat(repo.searchCandidates(me, "상한", now, 2))
              .extracting(r -> r.event().id())
              .containsExactly(soon, later);
        });
  }

  @Test
  @DisplayName("M365 시리즈 접기는 내가 볼 수 있는 회차 안에서 — 일부 회차만 참석자여도 시리즈가 보인다")
  void M365_시리즈_접기는_보이는_회차_안에서() {
    inTx(
        () -> {
          long me = TestFixtures.createHuman(dsl);
          long colleague = TestFixtures.createHuman(dsl);
          long colleagueCal = insertCalendar(dsl, colleague, null);
          // 가장 이른 다가오는 회차(내일)에는 내가 참석자가 아니다 — 이것이 대표로 뽑히면 시리즈 전체가 사라진다
          long hidden = insertEvent(dsl, colleague, colleagueCal, "공유 정례", null, now.plusDays(1));
          long visibleNext =
              insertEvent(dsl, colleague, colleagueCal, "공유 정례", null, now.plusDays(8));
          long visiblePast =
              insertEvent(dsl, colleague, colleagueCal, "공유 정례", null, now.minusDays(7));
          setSeries(List.of(hidden, visibleNext, visiblePast), "SM-PARTIAL");
          insertAttendee(dsl, visibleNext, me);
          insertAttendee(dsl, visiblePast, me);

          assertThat(repo.searchCandidates(me, "정례", now, 10))
              .extracting(r -> r.event().id())
              .containsExactly(visibleNext);
        });
  }

  /** M365 동기화 회차 행처럼 같은 시리즈 마스터 id 를 붙인다. */
  private void setSeries(List<Long> eventIds, String seriesMasterId) {
    dsl.update(CALENDAR_EVENT)
        .set(CALENDAR_EVENT.SERIES_MASTER_ID, seriesMasterId)
        .where(CALENDAR_EVENT.ID.in(eventIds))
        .execute();
  }

  private long insertAccount(long userId) {
    return dsl.insertInto(EMAIL_ACCOUNT)
        .set(EMAIL_ACCOUNT.USER_ID, userId)
        .set(EMAIL_ACCOUNT.EMAIL_ADDRESS, "acc-" + System.nanoTime() + "@example.com")
        .set(EMAIL_ACCOUNT.DISPLAY_NAME, "acc")
        .set(EMAIL_ACCOUNT.PROVIDER, "M365_GRAPH")
        .set(EMAIL_ACCOUNT.DISABLED_AT, OffsetDateTime.now())
        .returning(EMAIL_ACCOUNT.ID)
        .fetchOne()
        .getId();
  }
}
