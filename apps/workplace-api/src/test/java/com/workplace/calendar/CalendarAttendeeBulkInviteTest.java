package com.workplace.calendar;

import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.calendar.dto.CalendarEventRequest;
import com.workplace.calendar.dto.EditScope;
import com.workplace.calendar.repository.CalendarEventExceptionRepository;
import com.workplace.calendar.repository.EventAttendeeRepository;
import com.workplace.calendar.repository.EventAttendeeRepository.AttendeeRow;
import com.workplace.calendar.service.CalendarEventService;
import com.workplace.support.IntegrationTestBase;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.Supplier;
import java.util.stream.Collectors;
import org.jooq.DSLContext;
import org.jooq.ExecuteContext;
import org.jooq.ExecuteListener;
import org.jooq.ExecuteListenerProvider;
import org.jooq.impl.DefaultExecuteListenerProvider;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/**
 * 큰 조직을 한 번에 일정 참석자로 넣을 때(WP-1112) 쿼리 수가 사람 수에 비례하지 않는지 — 사람마다 종류 조회·삽입을 하던 루프를 일괄 조회·삽입으로 바꾼 것을
 * 고정한다. 같은 일정 모양에 5명과 40명을 넣어 실행한 SQL 문장 수가 같아야 한다. 메서드 롤백 격리.
 */
@Transactional
class CalendarAttendeeBulkInviteTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired CalendarEventService service;
  @Autowired EventAttendeeRepository attendeeRepo;
  @Autowired CalendarEventExceptionRepository exceptionRepo;

  private static final OffsetDateTime BASE = OffsetDateTime.parse("2026-07-01T09:00:00Z");

  private long seedUser(String prefix, String kind) {
    String t = UUID.randomUUID().toString().replace("-", "").substring(0, 8);
    return withMembership(
        dsl.insertInto(USER)
            .set(USER.USERNAME, prefix + "_" + t)
            .set(USER.PASSWORD, "pw")
            .set(USER.NAME, prefix + " " + t)
            .set(USER.EMAIL, prefix + "_" + t + "@example.com")
            .set(USER.KIND, kind)
            .returning(USER.ID)
            .fetchOne()
            .getId());
  }

  /** HUMAN n명 + AGENT 1명. */
  private List<Long> seedInvitees(int humans) {
    List<Long> ids = new ArrayList<>();
    for (int i = 0; i < humans; i++) ids.add(seedUser("h", "HUMAN"));
    ids.add(seedUser("a", "AGENT"));
    return ids;
  }

  /** 「이 일정만」 고친 회차 2개가 있는 매일 반복 일정의 마스터 id. */
  private long seriesWithTwoOverrides(long org) {
    long masterId =
        service
            .create(
                org,
                new CalendarEventRequest(
                    "회의",
                    null,
                    BASE,
                    BASE.plusHours(1),
                    false,
                    null,
                    null,
                    null,
                    "FREQ=DAILY",
                    List.of(),
                    null))
            .id();
    for (int day = 1; day <= 2; day++) {
      OffsetDateTime occ = BASE.plusDays(day);
      service.update(
          org,
          masterId,
          new CalendarEventRequest(
              "고친 회의",
              null,
              occ.plusHours(2),
              occ.plusHours(3),
              false,
              null,
              null,
              null,
              null,
              List.of(),
              null),
          EditScope.THIS,
          occ);
    }
    return masterId;
  }

  /** 작업 동안 실행된 SQL 문장 수 — 서비스가 쓰는 같은 DSLContext 설정에 잠시 세는 리스너를 단다. */
  private int countStatements(Runnable work) {
    AtomicInteger count = new AtomicInteger();
    // 같은 설정을 쓰는 다른 스레드(비동기 알림·스케줄러)의 쿼리는 세지 않는다 — 이 테스트 스레드가 낸 것만.
    Thread self = Thread.currentThread();
    ExecuteListener counter =
        new ExecuteListener() {
          @Override
          public void executeStart(ExecuteContext ctx) {
            if (Thread.currentThread() == self) count.incrementAndGet();
          }
        };
    ExecuteListenerProvider[] before = dsl.configuration().executeListenerProviders();
    ExecuteListenerProvider[] with = Arrays.copyOf(before, before.length + 1);
    with[before.length] = new DefaultExecuteListenerProvider(counter);
    dsl.configuration().set(with);
    try {
      work.run();
    } finally {
      dsl.configuration().set(before);
    }
    return count.get();
  }

  private <T> T measured(Supplier<T> work, AtomicInteger out) {
    List<T> box = new ArrayList<>(1);
    out.set(countStatements(() -> box.add(work.get())));
    return box.get(0);
  }

  @Test
  void inviteAttendees_queryCountDoesNotGrowWithInvitees() {
    long orgA = seedUser("org", "HUMAN");
    long orgB = seedUser("org", "HUMAN");
    long masterA = seriesWithTwoOverrides(orgA);
    long masterB = seriesWithTwoOverrides(orgB);
    List<Long> few = seedInvitees(5);
    List<Long> many = seedInvitees(40);

    int fewCount = countStatements(() -> service.inviteAttendees(orgA, masterA, few));
    int manyCount = countStatements(() -> service.inviteAttendees(orgB, masterB, many));

    assertThat(manyCount).as("40명 초대도 5명 초대와 같은 수의 SQL 로 끝나야 한다").isEqualTo(fewCount);
    // 마스터와 고친 회차 모두에 들어가고, AGENT 는 ACCEPTED·HUMAN 은 NEEDS_ACTION 이다.
    for (long eventId : eventsOf(masterB)) {
      List<AttendeeRow> rows = attendeeRepo.findByEvent(eventId);
      assertThat(rows).extracting(AttendeeRow::userId).containsAll(many);
      assertThat(
              rows.stream()
                  .filter(r -> many.contains(r.userId()))
                  .collect(Collectors.groupingBy(AttendeeRow::rsvpStatus, Collectors.counting())))
          .containsEntry("NEEDS_ACTION", 40L)
          .containsEntry("ACCEPTED", 1L);
    }
  }

  @Test
  void create_queryCountDoesNotGrowWithAttendees() {
    long org = seedUser("org", "HUMAN");
    List<Long> few = seedInvitees(5);
    List<Long> many = seedInvitees(40);
    AtomicInteger fewCount = new AtomicInteger();
    AtomicInteger manyCount = new AtomicInteger();

    // 첫 만들기는 기본 캘린더 마련 등 한 번만 하는 일이 섞이므로 먼저 한 번 만들어 둔다.
    service.create(org, oneOff(List.of()));
    measured(() -> service.create(org, oneOff(few)), fewCount);
    long id = measured(() -> service.create(org, oneOff(many)), manyCount).id();

    assertThat(manyCount.get()).as("참석자 40명 일정 만들기도 5명과 같은 수의 SQL").isEqualTo(fewCount.get());
    assertThat(attendeeRepo.findByEvent(id)).extracting(AttendeeRow::userId).containsAll(many);
  }

  /** 다시 넣은 사람은 그대로 두고 새 사람만 들어간다 — 같은 사람이 요청에 두 번 있어도 한 행. */
  @Test
  void inviteAttendees_keepsExistingAndDedupes() {
    long org = seedUser("org", "HUMAN");
    long master = seriesWithTwoOverrides(org);
    long existing = seedUser("h", "HUMAN");
    long fresh = seedUser("h", "HUMAN");
    service.inviteAttendees(org, master, List.of(existing));

    service.inviteAttendees(org, master, List.of(existing, fresh, fresh, org));

    assertThat(attendeeRepo.findByEvent(master))
        .extracting(AttendeeRow::userId)
        .containsExactlyInAnyOrder(org, existing, fresh);
  }

  private CalendarEventRequest oneOff(List<Long> attendees) {
    return new CalendarEventRequest(
        "회의", null, BASE, BASE.plusHours(1), false, null, null, null, null, attendees, null);
  }

  /** 마스터와 그 고친 회차 id 들. */
  private List<Long> eventsOf(long masterId) {
    List<Long> ids = new ArrayList<>();
    ids.add(masterId);
    ids.addAll(exceptionRepo.overrideEventIds(masterId));
    assertThat(ids).hasSize(3);
    return ids;
  }
}
