package com.workplace.calendar.service;

import static com.workplace.jooq.Tables.CALENDAR_EVENT;
import static com.workplace.jooq.Tables.CALENDAR_EVENT_NOTE;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.calendar.CalendarNoteTestBase;
import com.workplace.calendar.dto.CalendarEventRequest;
import com.workplace.calendar.dto.CalendarEventResponse;
import com.workplace.calendar.dto.EditScope;
import com.workplace.calendar.dto.EventNoteRef;
import com.workplace.calendar.repository.ExternalCalendarRepository.ExternalEventRow;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Set;
import org.junit.jupiter.api.Test;

/**
 * 회차를 옮기거나 지우거나 자를 때 노트 연결이 어떻게 되는지(WP-1701) — 이 회차만 옮기면 유지, 지우면 그 회차 연결 삭제, 이 회차부터 자르면 자른 시각 이후 연결
 * 삭제(새 시리즈로 옮기지 않음), 전체 수정으로 시작이 밀리면 안 맞는 연결은 숨김, M365 행은 upsert 로 유지되고 prune 으로 CASCADE 삭제.
 */
class CalendarEventNoteOccurrenceTest extends CalendarNoteTestBase {
  private static final OffsetDateTime OCC1 = START;
  private static final OffsetDateTime OCC2 = START.plusWeeks(1);
  private static final OffsetDateTime OCC3 = START.plusWeeks(2);

  /** 시리즈 수정용 요청 — 시작·종료·제목만 바꾸고 반복 규칙은 주간 유지. */
  private CalendarEventRequest req(String title, OffsetDateTime start) {
    return new CalendarEventRequest(
        title, null, start, start.plusHours(1), false, null, null, null, "FREQ=WEEKLY", null, null);
  }

  /** 11/18 회차를 「이 회차만」 03:00Z 로 옮겨 override 일정 id 를 돌려준다. */
  private long moveFirstOccurrence(long master) {
    eventService.update(ownerA, master, req("옮긴 회의", OCC1.plusHours(2)), EditScope.THIS, OCC1);
    return dsl.select(com.workplace.jooq.Tables.CALENDAR_EVENT_EXCEPTION.OVERRIDE_EVENT_ID)
        .from(com.workplace.jooq.Tables.CALENDAR_EVENT_EXCEPTION)
        .where(com.workplace.jooq.Tables.CALENDAR_EVENT_EXCEPTION.EVENT_ID.eq(master))
        .fetchOne(com.workplace.jooq.Tables.CALENDAR_EVENT_EXCEPTION.OVERRIDE_EVENT_ID);
  }

  /** 세 회차(11/18·11/25·12/02) 모두에 노트를 잇는다. */
  private long weeklyLinkedAll() {
    long master = weeklyEvent(ownerA);
    eventService.linkNote(ownerA, master, OCC1, pA);
    eventService.linkNote(ownerA, master, OCC2, pA);
    eventService.linkNote(ownerA, master, OCC3, pA);
    return master;
  }

  private int rowsAt(long master, OffsetDateTime occ) {
    return dsl.fetchCount(
        CALENDAR_EVENT_NOTE,
        CALENDAR_EVENT_NOTE.EVENT_ID.eq(master).and(CALENDAR_EVENT_NOTE.OCCURRENCE_START.eq(occ)));
  }

  /**
   * 행의 실제 updated_at 을 읽는다(WP-2156) — prune 의 since 는 이 값과 같은 시계로 비교하므로, JVM now() 를 넘기면 컨테이너 시계가
   * 앞설 때 행이 가드로 보호되어 지워지지 않는다.
   */
  private OffsetDateTime updatedAtOf(long eventId) {
    return dsl.select(CALENDAR_EVENT.UPDATED_AT)
        .from(CALENDAR_EVENT)
        .where(CALENDAR_EVENT.ID.eq(eventId))
        .fetchOne(CALENDAR_EVENT.UPDATED_AT);
  }

  @Test
  void moveThisOccurrence_keepsLink() {
    long master = weeklyEvent(ownerA);
    eventService.linkNote(ownerA, master, OCC1, pA);

    long override = moveFirstOccurrence(master);

    List<CalendarEventResponse> list =
        eventService.list(ownerA, OCC1.minusDays(1), OCC1.plusDays(1));
    CalendarEventResponse item =
        list.stream().filter(x -> x.id() == override).findFirst().orElseThrow();
    assertThat(item.note()).isNotNull();
    assertThat(item.note().pageId()).isEqualTo(pA);
    EventNoteRef viaOverride = eventService.getNote(ownerA, override, null).note();
    assertThat(viaOverride.pageId()).isEqualTo(pA);
    assertThat(eventService.getNote(ownerA, master, OCC2).note()).isNull();
  }

  @Test
  void deleteThisOccurrence_removesLink() {
    long master = weeklyEvent(ownerA);
    eventService.linkNote(ownerA, master, OCC1, pA);
    eventService.linkNote(ownerA, master, OCC2, pA);

    eventService.delete(ownerA, master, EditScope.THIS, OCC1);

    assertThat(rowsAt(master, OCC1)).isZero();
    assertThat(rowsAt(master, OCC2)).isEqualTo(1);
  }

  @Test
  void deleteOverrideDirectly_removesLink() {
    long master = weeklyEvent(ownerA);
    eventService.linkNote(ownerA, master, OCC1, pA);
    long override = moveFirstOccurrence(master);

    eventService.delete(ownerA, override, EditScope.ALL, null);

    assertThat(noteRows(master)).isZero();
  }

  /** 직접 지운 override 로 노트를 이으려 하면 없는 일정과 같은 404 — 취소된 회차에 노트가 남지 않는다(WP-1701). */
  @Test
  void linkViaDeletedOverride_throwsEventNotFound() {
    long master = weeklyEvent(ownerA);
    long override = moveFirstOccurrence(master);
    eventService.delete(ownerA, override, EditScope.ALL, null);

    org.assertj.core.api.Assertions.assertThatThrownBy(
            () -> eventService.linkNote(ownerA, override, null, pA))
        .isInstanceOf(com.workplace.calendar.exception.CalendarEventNotFoundException.class);
    assertThat(noteRows(master)).isZero();
  }

  @Test
  void deleteOverrideViaThisScope_removesLink() {
    long master = weeklyEvent(ownerA);
    eventService.linkNote(ownerA, master, OCC1, pA);
    moveFirstOccurrence(master);

    eventService.delete(ownerA, master, EditScope.THIS, OCC1);

    assertThat(noteRows(master)).isZero();
  }

  @Test
  void truncateFollowing_delete_removesLinksFromCut() {
    long master = weeklyLinkedAll();

    eventService.delete(ownerA, master, EditScope.THIS_AND_FOLLOWING, OCC2);

    assertThat(rowsAt(master, OCC1)).isEqualTo(1);
    assertThat(noteRows(master)).isEqualTo(1);
  }

  @Test
  void truncateFollowing_update_doesNotMoveToNewSeries() {
    long master = weeklyLinkedAll();

    CalendarEventResponse created =
        eventService.update(ownerA, master, req("새 시리즈", OCC2), EditScope.THIS_AND_FOLLOWING, OCC2);

    assertThat(created.id()).isNotEqualTo(master);
    assertThat(rowsAt(master, OCC1)).isEqualTo(1);
    assertThat(noteRows(master)).isEqualTo(1);
    assertThat(noteRows(created.id())).isZero();
  }

  @Test
  void deleteAll_cascades() {
    long master = weeklyLinkedAll();

    eventService.delete(ownerA, master, EditScope.ALL, null);

    assertThat(noteRows(master)).isZero();
  }

  @Test
  void updateAll_shiftedStart_hidesStaleLink() {
    long master = weeklyEvent(ownerA);
    eventService.linkNote(ownerA, master, OCC1, pA);

    // 전체 수정으로 시작이 02:00Z 로 밀리면 옛 키(01:00Z)는 어느 회차와도 맞지 않는다 — 재키하지 않고 숨긴다.
    eventService.update(ownerA, master, req("밀린 회의", OCC1.plusHours(1)), EditScope.ALL, null);

    List<CalendarEventResponse> list =
        eventService.list(ownerA, OCC1.minusDays(1), OCC1.plusDays(22));
    assertThat(list).isNotEmpty();
    assertThat(list).allSatisfy(x -> assertThat(x.note()).isNull());
    assertThat(noteRows(master)).isEqualTo(1);
  }

  @Test
  void m365_upsertKeepsLink_pruneCascades() {
    long ext = seedExternalEvent(false, "ext-note-1");
    eventService.linkNote(ownerA, ext, null, pA);
    long calId =
        dsl.select(CALENDAR_EVENT.CALENDAR_ID)
            .from(CALENDAR_EVENT)
            .where(CALENDAR_EVENT.ID.eq(ext))
            .fetchOne(CALENDAR_EVENT.CALENDAR_ID);

    long again =
        callInTenant(
            1L,
            () ->
                extRepo
                    .upsertExternalEvent(
                        ownerA,
                        calId,
                        "ext-note-1",
                        new ExternalEventRow(
                            "제목 변경",
                            null,
                            START.plusWeeks(1),
                            START.plusWeeks(1).plusHours(1),
                            false,
                            null,
                            null,
                            null,
                            null,
                            null))
                    .id());
    assertThat(again).isEqualTo(ext);
    assertThat(noteRows(ext)).isEqualTo(1);

    List<Long> pruned =
        callInTenant(
            1L,
            // since 는 행의 updated_at 보다 뒤 — 가드가 이 행을 건너뛰지 않아 prune 이 지우는 기존(무가드) 동작을 그대로 유지한다.
            // JVM now() 가 아니라 행의 실제 값을 +1초 쓴다 — 컨테이너(DB) 시계가 앞서면 now() 로는 행이 가드로 보호돼 지워지지 않아 테스트가
            // 흔들린다(WP-2156).
            () -> {
              OffsetDateTime since = updatedAtOf(ext).plusSeconds(1);
              return extRepo.pruneEventsNotIn(
                  calId, Set.of(), START.minusDays(1), START.plusMonths(1), since);
            });
    assertThat(pruned).containsExactly(ext);
    assertThat(noteRows(ext)).isZero();
  }
}
