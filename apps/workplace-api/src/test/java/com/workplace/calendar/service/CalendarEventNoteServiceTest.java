package com.workplace.calendar.service;

import static com.workplace.jooq.Tables.CALENDAR_EVENT_EXCEPTION;
import static com.workplace.jooq.Tables.WIKI_PAGE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.anyCollection;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.clearInvocations;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;

import com.workplace.calendar.CalendarNoteTestBase;
import com.workplace.calendar.dto.CalendarEventRequest;
import com.workplace.calendar.dto.CalendarEventResponse;
import com.workplace.calendar.dto.EditScope;
import com.workplace.calendar.dto.EventNoteLinkResponse;
import com.workplace.calendar.dto.EventNoteRef;
import com.workplace.calendar.dto.NoteKey;
import com.workplace.calendar.exception.CalendarEventNotFoundException;
import com.workplace.calendar.exception.ReadOnlyCalendarException;
import com.workplace.calendar.repository.CalendarEventNoteRepository;
import com.workplace.global.tenant.TenantContext;
import com.workplace.wiki.exception.WikiPageNotFoundException;
import com.workplace.wiki.service.WikiPageReadAccess;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;

/**
 * 일정·회차 노트 잇기·끊기·조회(WP-1701) — 서비스 계층. 반복 회차 키·override 키·권한·동시성·목록 N+1 을 고정한다.
 * 비-@Transactional(커밋)이라 동시 잇기와 노트 삭제 경합을 실제 트랜잭션으로 본다.
 */
class CalendarEventNoteServiceTest extends CalendarNoteTestBase {
  @Autowired CalendarEventNoteRepository noteRepo;
  @MockitoSpyBean WikiPageReadAccess wikiAccess;

  private static final OffsetDateTime OCC1 = START;
  private static final OffsetDateTime OCC2 = START.plusWeeks(1);

  private EventNoteRef noteOf(long callerId, long id, OffsetDateTime occ) {
    return eventService.getNote(callerId, id, occ).note();
  }

  private long overrideIdOf(long masterId) {
    return dsl.select(CALENDAR_EVENT_EXCEPTION.OVERRIDE_EVENT_ID)
        .from(CALENDAR_EVENT_EXCEPTION)
        .where(CALENDAR_EVENT_EXCEPTION.EVENT_ID.eq(masterId))
        .fetchOne(CALENDAR_EVENT_EXCEPTION.OVERRIDE_EVENT_ID);
  }

  /** 11/18 회차를 「이 회차만」 두 시간 뒤로 옮겨 override 일정을 만든다. */
  private long makeOverride(long masterId) {
    eventService.update(
        ownerA,
        masterId,
        new CalendarEventRequest(
            "옮긴 회의",
            null,
            OCC1.plusHours(2),
            OCC1.plusHours(3),
            false,
            null,
            null,
            null,
            "FREQ=WEEKLY",
            null,
            null),
        EditScope.THIS,
        OCC1);
    return overrideIdOf(masterId);
  }

  @Test
  void link_singleEvent_thenGetReturnsCard() {
    long e = singleEvent(ownerA);
    EventNoteLinkResponse res = eventService.linkNote(ownerA, e, null, pA);
    assertThat(res.note().restricted()).isFalse();
    assertThat(res.note().pageId()).isEqualTo(pA);
    assertThat(res.note().title()).isEqualTo("A 만 보는 노트");
    assertThat(res.note().spaceName()).startsWith("회의록A-");
    assertThat(res.note().updatedAt()).isNotNull();
    EventNoteRef got = noteOf(ownerA, e, null);
    assertThat(got).isEqualTo(res.note());
  }

  @Test
  void link_recurringOccurrence_onlyThatOccurrence() {
    long e = weeklyEvent(ownerA);
    eventService.linkNote(ownerA, e, OCC1, pA);
    assertThat(noteOf(ownerA, e, OCC1).pageId()).isEqualTo(pA);
    assertThat(noteOf(ownerA, e, OCC2)).isNull();
  }

  @Test
  void link_recurringWithoutOccurrence_400() {
    long e = weeklyEvent(ownerA);
    assertThatThrownBy(() -> eventService.linkNote(ownerA, e, null, pA))
        .isInstanceOf(IllegalArgumentException.class);
    assertThat(noteRows(e)).isZero();
  }

  @Test
  void link_notARealOccurrence_400() {
    long e = weeklyEvent(ownerA);
    assertThatThrownBy(() -> eventService.linkNote(ownerA, e, OCC1.plusDays(1), pA))
        .isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void link_cancelledOccurrence_400() {
    long e = weeklyEvent(ownerA);
    eventService.delete(ownerA, e, EditScope.THIS, OCC1);
    assertThatThrownBy(() -> eventService.linkNote(ownerA, e, OCC1, pA))
        .isInstanceOf(IllegalArgumentException.class);
    assertThat(noteRows(e)).isZero();
  }

  @Test
  void link_viaOverrideId_storesOnMasterOriginalStart() {
    long master = weeklyEvent(ownerA);
    long override = makeOverride(master);

    // 웹은 override id 를 occurrenceDate 없이 보낸다.
    eventService.linkNote(ownerA, override, null, pA);

    assertThat(noteRows(override)).isZero();
    assertThat(noteRepo.find(NoteKey.of(master, OCC1))).isPresent();
    assertThat(noteOf(ownerA, master, OCC1).pageId()).isEqualTo(pA);
    assertThat(noteOf(ownerA, override, null).pageId()).isEqualTo(pA);
  }

  @Test
  void link_replacesExisting() {
    long e = singleEvent(ownerA);
    eventService.linkNote(ownerA, e, null, pA);
    eventService.linkNote(ownerA, e, null, pShared);
    assertThat(noteOf(ownerA, e, null).pageId()).isEqualTo(pShared);
    assertThat(noteRows(e)).isEqualTo(1);
  }

  /** 두 사람이 같은 회차에 동시에 이어도 둘 다 성공하고 마지막으로 커밋한 쪽의 노트 한 줄만 남는다. */
  @Test
  void link_concurrent_lastWriterWins() throws Exception {
    long e = weeklyEvent(ownerA);
    // 마스터 잠금 뒤에 부르는 requireReadable 의 호출 순서 = 잠금 순서 = 커밋 순서. 잠금을 쥔 쪽이 잠시 머물러 다른 쪽이 실제로 기다리게 한다.
    List<Long> order = Collections.synchronizedList(new ArrayList<>());
    doAnswer(
            inv -> {
              order.add(inv.getArgument(1));
              Thread.sleep(300);
              return inv.callRealMethod();
            })
        .when(wikiAccess)
        .requireReadable(anyLong(), anyLong());

    CountDownLatch go = new CountDownLatch(1);
    ExecutorService pool = Executors.newFixedThreadPool(2);
    try {
      Future<?> f1 = pool.submit(() -> linkAfter(go, e, pA));
      Future<?> f2 = pool.submit(() -> linkAfter(go, e, pShared));
      go.countDown();
      f1.get(30, TimeUnit.SECONDS);
      f2.get(30, TimeUnit.SECONDS);
    } finally {
      pool.shutdownNow();
    }

    assertThat(noteRows(e)).isEqualTo(1);
    assertThat(order).hasSize(2);
    assertThat(noteRepo.find(NoteKey.of(e, OCC1)).orElseThrow().wikiPageId())
        .isEqualTo(order.get(1));
  }

  private void linkAfter(CountDownLatch go, long eventId, long pageId) {
    try {
      go.await();
      TenantContext.set(1L);
      eventService.linkNote(ownerA, eventId, OCC1, pageId);
    } catch (InterruptedException ex) {
      throw new IllegalStateException(ex);
    } finally {
      TenantContext.clear();
    }
  }

  @Test
  void link_unreadablePage_throwsPageNotFound() {
    long e = singleEvent(strangerC);
    assertThatThrownBy(() -> eventService.linkNote(strangerC, e, null, pA))
        .isInstanceOf(WikiPageNotFoundException.class);
    assertThat(noteRows(e)).isZero();
  }

  /** 읽기 판정 뒤 삽입 전에 노트가 지워지면(외래 키 위반) 500 이 아니라 같은 노트 없음 404 로 돌려준다. */
  @Test
  void link_pageDeletedBetweenCheckAndInsert_throwsPageNotFound() throws Exception {
    long e = singleEvent(ownerA);
    doAnswer(
            inv -> {
              Object r = inv.callRealMethod();
              // 판정이 끝난 뒤 다른 트랜잭션(스레드)에서 노트를 지운다 — 이 일정 쓰기 tx 는 아직 삽입 전이다.
              ExecutorService pool = Executors.newSingleThreadExecutor();
              try {
                pool.submit(
                        () -> {
                          TenantContext.set(1L);
                          try {
                            pageService.delete(ownerA, pA);
                          } finally {
                            TenantContext.clear();
                          }
                        })
                    .get(30, TimeUnit.SECONDS);
              } finally {
                pool.shutdownNow();
              }
              return r;
            })
        .when(wikiAccess)
        .requireReadable(anyLong(), anyLong());

    assertThatThrownBy(() -> eventService.linkNote(ownerA, e, null, pA))
        .isInstanceOf(WikiPageNotFoundException.class);
    assertThat(noteRows(e)).isZero();
    assertThat(dsl.fetchCount(WIKI_PAGE, WIKI_PAGE.ID.eq(pA))).isZero();
  }

  @Test
  void link_readOnlyM365_409() {
    long ev = seedExternalEvent(true, "ro-evt");
    assertThatThrownBy(() -> eventService.linkNote(ownerA, ev, null, pA))
        .isInstanceOf(ReadOnlyCalendarException.class);
    assertThat(noteRows(ev)).isZero();
  }

  @Test
  void link_attendee_404() {
    long e = weeklyEvent(ownerA, attendeeB);
    assertThatThrownBy(() -> eventService.linkNote(attendeeB, e, OCC1, pShared))
        .isInstanceOf(CalendarEventNotFoundException.class);
    assertThat(noteRows(e)).isZero();
  }

  @Test
  void link_m365Row_storesNullOccurrence() {
    long ev = seedExternalEvent(false, "rw-evt");
    // 회차 날짜를 줘도 M365 회차 행은 (행 id, NULL) 이다.
    eventService.linkNote(ownerA, ev, OCC2, pA);
    assertThat(noteRepo.find(new NoteKey(ev, null))).isPresent();
    assertThat(noteOf(ownerA, ev, null).pageId()).isEqualTo(pA);
  }

  @Test
  void unlink_removesLink_pageRemains() {
    long e = singleEvent(ownerA);
    eventService.linkNote(ownerA, e, null, pA);
    eventService.unlinkNote(ownerA, e, null);
    assertThat(noteOf(ownerA, e, null)).isNull();
    assertThat(dsl.fetchCount(WIKI_PAGE, WIKI_PAGE.ID.eq(pA))).isEqualTo(1);
  }

  @Test
  void unlink_noLink_isNoop() {
    long e = singleEvent(ownerA);
    eventService.unlinkNote(ownerA, e, null);
    assertThat(noteRows(e)).isZero();
  }

  @Test
  void getNote_attendeeCannotReadNote_restrictedOnly() {
    long e = weeklyEvent(ownerA, attendeeB);
    eventService.linkNote(ownerA, e, OCC1, pA);
    EventNoteRef ref = noteOf(attendeeB, e, OCC1);
    assertThat(ref).isEqualTo(EventNoteRef.restrictedRef());
    assertThat(ref.pageId()).isNull();
    assertThat(ref.title()).isNull();
  }

  @Test
  void getNote_attendeeCanReadSharedNote() {
    long e = weeklyEvent(ownerA, attendeeB);
    eventService.linkNote(ownerA, e, OCC1, pShared);
    assertThat(noteOf(attendeeB, e, OCC1).restricted()).isFalse();
  }

  @Test
  void getNote_deletedPage_returnsNull() {
    long e = singleEvent(ownerA);
    eventService.linkNote(ownerA, e, null, pShared);
    pageService.delete(ownerA, pShared);
    assertThat(noteOf(ownerA, e, null)).isNull();
  }

  @Test
  void getNote_stranger_404() {
    long e = singleEvent(ownerA);
    assertThatThrownBy(() -> eventService.getNote(strangerC, e, null))
        .isInstanceOf(CalendarEventNotFoundException.class);
  }

  @Test
  void list_fillsNotes_perOccurrence() {
    long master = weeklyEvent(ownerA);
    long override = makeOverride(master);
    eventService.linkNote(ownerA, master, OCC2, pA);
    eventService.linkNote(ownerA, override, null, pShared);

    List<CalendarEventResponse> list =
        eventService.list(ownerA, OCC1.minusDays(7), OCC1.plusDays(21));
    CalendarEventResponse overrideItem =
        list.stream().filter(x -> x.id() == override).findFirst().orElseThrow();
    CalendarEventResponse occ2Item =
        list.stream()
            .filter(x -> x.startsAt().toInstant().equals(OCC2.toInstant()))
            .findFirst()
            .orElseThrow();
    assertThat(overrideItem.note().pageId()).isEqualTo(pShared);
    assertThat(occ2Item.note().pageId()).isEqualTo(pA);
    assertThat(list.stream().filter(x -> x.note() != null)).hasSize(2);
  }

  @Test
  void list_fillsNotes_withSingleWikiBatch() {
    long e = weeklyEvent(ownerA);
    for (int i = 0; i < 5; i++) {
      eventService.linkNote(ownerA, e, OCC1.plusWeeks(i), pA);
    }
    clearInvocations(wikiAccess);

    List<CalendarEventResponse> list =
        eventService.list(ownerA, OCC1.minusDays(1), OCC1.plusWeeks(6));

    assertThat(list.stream().filter(x -> x.note() != null)).hasSize(5);
    verify(wikiAccess, times(1)).readableCards(anyLong(), anyCollection());
  }

  @Test
  void get_withOccurrenceDate_fillsNote() {
    long e = weeklyEvent(ownerA);
    eventService.linkNote(ownerA, e, OCC2, pA);
    assertThat(eventService.get(ownerA, e, OCC2).note().pageId()).isEqualTo(pA);
    assertThat(eventService.get(ownerA, e, OCC1).note()).isNull();
  }

  @Test
  void get_recurringMasterWithoutOccurrence_noteNull() {
    long e = weeklyEvent(ownerA);
    eventService.linkNote(ownerA, e, OCC1, pA);
    assertThat(eventService.get(ownerA, e).note()).isNull();
  }
}
