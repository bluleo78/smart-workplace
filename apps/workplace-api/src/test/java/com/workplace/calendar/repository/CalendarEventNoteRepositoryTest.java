package com.workplace.calendar.repository;

import static com.workplace.jooq.Tables.CALENDAR;
import static com.workplace.jooq.Tables.CALENDAR_EVENT;
import static com.workplace.jooq.Tables.CALENDAR_EVENT_NOTE;
import static com.workplace.jooq.Tables.WIKI_PAGE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.calendar.dto.NoteKey;
import com.workplace.calendar.repository.CalendarEventNoteRepository.NoteLinkRow;
import com.workplace.global.tenant.TenantContext;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import com.workplace.wiki.dto.CreatePageRequest;
import com.workplace.wiki.service.WikiPageService;
import com.workplace.wiki.service.WikiSpaceService;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.transaction.annotation.Transactional;

/** calendar_event_note 저장소(WP-1701) — 키 한 줄 보장(NULL 슬롯 포함)·자르기 삭제·CASCADE·Instant 키 매칭. */
@Transactional
class CalendarEventNoteRepositoryTest extends IntegrationTestBase {
  @Autowired DSLContext dsl;
  @Autowired CalendarEventNoteRepository repo;
  @Autowired WikiSpaceService spaceService;
  @Autowired WikiPageService pageService;

  private long ownerId;
  private long calendarId;
  private long spaceId;

  @BeforeEach
  void seed() {
    TenantContext.set(1L);
    ownerId = TestFixtures.createHuman(dsl);
    calendarId =
        dsl.insertInto(CALENDAR)
            .set(CALENDAR.OWNER_ID, ownerId)
            .set(CALENDAR.NAME, "기본")
            .set(CALENDAR.COLOR, "blue")
            .set(CALENDAR.IS_DEFAULT, true)
            .returning(CALENDAR.ID)
            .fetchOne()
            .getId();
    spaceId = spaceService.createTeamSpace(ownerId, "노트연결-" + UUID.randomUUID()).id();
  }

  private long event() {
    return dsl.insertInto(CALENDAR_EVENT)
        .set(CALENDAR_EVENT.OWNER_ID, ownerId)
        .set(CALENDAR_EVENT.CALENDAR_ID, calendarId)
        .set(CALENDAR_EVENT.TITLE, "회의")
        .set(CALENDAR_EVENT.STARTS_AT, OffsetDateTime.parse("2026-11-18T01:00:00Z"))
        .set(CALENDAR_EVENT.ENDS_AT, OffsetDateTime.parse("2026-11-18T02:00:00Z"))
        .returning(CALENDAR_EVENT.ID)
        .fetchOne()
        .getId();
  }

  private long page(String title) {
    return pageService.create(ownerId, spaceId, new CreatePageRequest(null, title)).id();
  }

  private int rows(long eventId) {
    return dsl.fetchCount(CALENDAR_EVENT_NOTE, CALENDAR_EVENT_NOTE.EVENT_ID.eq(eventId));
  }

  @Test
  void replace_sameKeyTwice_keepsOneRowWithLatestPage() {
    long e = event();
    long a = page("A");
    long b = page("B");
    NoteKey key = NoteKey.of(e, OffsetDateTime.parse("2026-11-18T01:00:00Z"));
    repo.replace(key, a, ownerId);
    repo.replace(key, b, ownerId);
    assertThat(repo.find(key)).get().extracting(NoteLinkRow::wikiPageId).isEqualTo(b);
    assertThat(rows(e)).isEqualTo(1);
  }

  @Test
  void nullAndNonNullOccurrence_areSeparateSlots() {
    long e = event();
    long a = page("A");
    long b = page("B");
    NoteKey single = NoteKey.of(e, null);
    NoteKey occ = NoteKey.of(e, OffsetDateTime.parse("2026-11-18T01:00:00Z"));
    repo.replace(single, a, ownerId);
    repo.replace(occ, b, ownerId);
    assertThat(repo.find(single)).get().extracting(NoteLinkRow::wikiPageId).isEqualTo(a);
    assertThat(repo.find(occ)).get().extracting(NoteLinkRow::wikiPageId).isEqualTo(b);
    assertThat(rows(e)).isEqualTo(2);
  }

  @Test
  void uniqueIndex_rejectsSecondNullRow() {
    long e = event();
    long a = page("A");
    dsl.insertInto(CALENDAR_EVENT_NOTE)
        .set(CALENDAR_EVENT_NOTE.EVENT_ID, e)
        .set(CALENDAR_EVENT_NOTE.WIKI_PAGE_ID, a)
        .execute();
    assertThatThrownBy(
            () ->
                dsl.insertInto(CALENDAR_EVENT_NOTE)
                    .set(CALENDAR_EVENT_NOTE.EVENT_ID, e)
                    .set(CALENDAR_EVENT_NOTE.WIKI_PAGE_ID, a)
                    .execute())
        .isInstanceOf(DataIntegrityViolationException.class);
  }

  @Test
  void deleteFrom_removesOnlyAtOrAfter() {
    long e = event();
    long a = page("A");
    OffsetDateTime d11 = OffsetDateTime.parse("2026-11-11T01:00:00Z");
    OffsetDateTime d18 = OffsetDateTime.parse("2026-11-18T01:00:00Z");
    OffsetDateTime d25 = OffsetDateTime.parse("2026-11-25T01:00:00Z");
    repo.replace(NoteKey.of(e, d11), a, ownerId);
    repo.replace(NoteKey.of(e, d18), a, ownerId);
    repo.replace(NoteKey.of(e, d25), a, ownerId);
    assertThat(repo.deleteFrom(e, d18)).isEqualTo(2);
    assertThat(repo.find(NoteKey.of(e, d11))).isPresent();
    assertThat(repo.find(NoteKey.of(e, d18))).isEmpty();
    assertThat(rows(e)).isEqualTo(1);
  }

  @Test
  void deletingWikiPage_cascadesLink() {
    long e = event();
    long a = page("A");
    repo.replace(NoteKey.of(e, null), a, ownerId);
    dsl.deleteFrom(WIKI_PAGE).where(WIKI_PAGE.ID.eq(a)).execute();
    assertThat(rows(e)).isZero();
  }

  @Test
  void deletingEvent_cascadesLink() {
    long e = event();
    long a = page("A");
    repo.replace(NoteKey.of(e, null), a, ownerId);
    dsl.deleteFrom(CALENDAR_EVENT).where(CALENDAR_EVENT.ID.eq(e)).execute();
    assertThat(rows(e)).isZero();
  }

  @Test
  void findByEventIds_mapsByInstantKey() {
    long e = event();
    long a = page("A");
    // +09:00 로 넣은 같은 순간(= 2026-11-18T01:00Z)을 Z Instant 키로 찾는다.
    dsl.insertInto(CALENDAR_EVENT_NOTE)
        .set(CALENDAR_EVENT_NOTE.EVENT_ID, e)
        .set(
            CALENDAR_EVENT_NOTE.OCCURRENCE_START, OffsetDateTime.parse("2026-11-18T10:00:00+09:00"))
        .set(CALENDAR_EVENT_NOTE.WIKI_PAGE_ID, a)
        .execute();
    Map<NoteKey, NoteLinkRow> found = repo.findByEventIds(List.of(e));
    assertThat(found).containsKey(NoteKey.of(e, OffsetDateTime.parse("2026-11-18T01:00:00Z")));
    assertThat(repo.findByEventIds(List.of())).isEmpty();
  }
}
