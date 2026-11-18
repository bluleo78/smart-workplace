package com.workplace.calendar.repository;

import static com.workplace.jooq.Tables.CALENDAR_EVENT_NOTE;

import com.workplace.calendar.dto.NoteKey;
import com.workplace.wiki.exception.WikiPageNotFoundException;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.Collection;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import lombok.RequiredArgsConstructor;
import org.jooq.Condition;
import org.jooq.DSLContext;
import org.jooq.Record;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Repository;

/**
 * calendar_event_note 접근(WP-1701) — 일정(반복이면 회차)마다 노트 하나를 잇는 표. 키는 {@link NoteKey}(일정 행 id + 회차 원래
 * 시작 시각, null 이면 회차 없음). 일정·회차당 한 줄이고, 시각은 항상 {@link Instant} 로 맞춘다(timestamptz 라 문자열 비교 금지).
 */
@Repository
@RequiredArgsConstructor
public class CalendarEventNoteRepository {
  private final DSLContext dsl;

  /**
   * 연결 한 줄.
   *
   * @param linkedBy 연결한 사람(사용자 삭제 시 null)
   */
  public record NoteLinkRow(
      long eventId,
      Instant occurrenceStart,
      long wikiPageId,
      Long linkedBy,
      OffsetDateTime linkedAt) {

    /** 이 줄의 키. */
    public NoteKey key() {
      return new NoteKey(eventId, occurrenceStart);
    }
  }

  /** 키 한 줄을 고르는 조건 — occurrence_start 가 null 이면 IS NULL(NULL = NULL 은 거짓이라 따로 가른다). */
  private static Condition keyCondition(NoteKey key) {
    Condition c = CALENDAR_EVENT_NOTE.EVENT_ID.eq(key.eventId());
    return key.occurrenceStart() == null
        ? c.and(CALENDAR_EVENT_NOTE.OCCURRENCE_START.isNull())
        : c.and(CALENDAR_EVENT_NOTE.OCCURRENCE_START.eq(toOffset(key.occurrenceStart())));
  }

  private static OffsetDateTime toOffset(Instant i) {
    return OffsetDateTime.ofInstant(i, ZoneOffset.UTC);
  }

  private static NoteLinkRow toRow(Record r) {
    OffsetDateTime occ = r.get(CALENDAR_EVENT_NOTE.OCCURRENCE_START);
    return new NoteLinkRow(
        r.get(CALENDAR_EVENT_NOTE.EVENT_ID),
        occ == null ? null : occ.toInstant(),
        r.get(CALENDAR_EVENT_NOTE.WIKI_PAGE_ID),
        r.get(CALENDAR_EVENT_NOTE.LINKED_BY),
        r.get(CALENDAR_EVENT_NOTE.LINKED_AT));
  }

  /** 키의 연결 한 줄. 없으면 empty. */
  public Optional<NoteLinkRow> find(NoteKey key) {
    return dsl.selectFrom(CALENDAR_EVENT_NOTE)
        .where(keyCondition(key))
        .fetchOptional()
        .map(r -> toRow(r));
  }

  /**
   * 요청한 키들의 연결만 쿼리 한 번에 키별로 모은다(목록 응답 채우기용, N+1 금지, WP-1737). 돌려주는 맵에는 요청한 키만 든다.
   *
   * <p>키마다 바인드 값을 두는 {@code (event_id, occurrence_start) IN (..)} 은 쓰지 않는다 — 월·연 목록(최대 366일)은 반복 일정
   * 회차 키가 수만 개라 PostgreSQL 바인드 값 한도(32767)를 넘겨 500 이 난다. 대신 바인드 값 수가 일정 수에만 비례하는 좁은 범위로 읽는다: {@code
   * event_id IN (서로 다른 일정 id) AND (occurrence_start IS NULL OR occurrence_start BETWEEN 키 중 가장 이른
   * 회차 AND 가장 늦은 회차)}(회차 키가 하나도 없으면 {@code occurrence_start IS NULL} 만). 범위 안의 다른 회차 줄이 조금 더 읽힐 수
   * 있어, 요청한 키만 자바에서 남긴다 — 그래서 메서드 약속(「요청한 키만」)은 저장소 안에서 지켜진다. 시각은 keyCondition 과 같이 UTC
   * OffsetDateTime 으로 바꿔 비교한다. 빈 입력은 쿼리 없이 빈 맵.
   */
  public Map<NoteKey, NoteLinkRow> findByKeys(Collection<NoteKey> keys) {
    Map<NoteKey, NoteLinkRow> result = new HashMap<>();
    if (keys == null || keys.isEmpty()) {
      return result;
    }
    // 정확히 맞춰 볼 키 집합(Instant 기준 — NoteKey 의 equals 가 그대로 쓰인다)과, 쿼리 범위를 정할 일정 id·회차 최소/최대
    Set<NoteKey> wanted = new HashSet<>(keys);
    Set<Long> eventIds = new HashSet<>();
    Instant minOcc = null;
    Instant maxOcc = null;
    for (NoteKey k : wanted) {
      eventIds.add(k.eventId());
      Instant occ = k.occurrenceStart();
      if (occ != null) {
        if (minOcc == null || occ.isBefore(minOcc)) minOcc = occ;
        if (maxOcc == null || occ.isAfter(maxOcc)) maxOcc = occ;
      }
    }
    Condition slot = CALENDAR_EVENT_NOTE.OCCURRENCE_START.isNull();
    if (minOcc != null) {
      slot =
          slot.or(CALENDAR_EVENT_NOTE.OCCURRENCE_START.between(toOffset(minOcc), toOffset(maxOcc)));
    }
    dsl.selectFrom(CALENDAR_EVENT_NOTE)
        .where(CALENDAR_EVENT_NOTE.EVENT_ID.in(eventIds))
        .and(slot)
        .fetch()
        .forEach(
            r -> {
              NoteLinkRow row = toRow(r);
              // 범위로 함께 읽힌 다른 회차·회차 없는 줄 중 요청하지 않은 것은 버린다
              if (wanted.contains(row.key())) {
                result.put(row.key(), row);
              }
            });
    return result;
  }

  /** calendar_event_note.wiki_page_id 외래 키 제약 이름(V306 의 인라인 REFERENCES 기본 이름, WP-1701). */
  private static final String NOTE_WIKI_PAGE_FK = "calendar_event_note_wiki_page_id_fkey";

  /**
   * 키의 연결을 바꾼다 — 그 키의 줄을 지우고 새로 넣는다(마지막 요청이 이긴다). 호출자가 일정(마스터) 행을 {@code FOR UPDATE} 로 잠근 상태여야 같은 키
   * 동시 삽입이 직렬화돼 유일 인덱스 위반이 나지 않는다.
   *
   * <p>읽기 판정과 삽입 사이에 노트가 지워져 wiki_page 외래 키가 깨지면(Postgres 오류 메시지에 제약 이름이 든다) 노트 API 와 같은 {@link
   * WikiPageNotFoundException} 으로 바꾼다(500 금지, WP-1701). 다른 무결성 오류(테넌트·일정 FK 등)는 그대로 올린다.
   */
  public void replace(NoteKey key, long wikiPageId, long linkedBy) {
    dsl.deleteFrom(CALENDAR_EVENT_NOTE).where(keyCondition(key)).execute();
    try {
      dsl.insertInto(CALENDAR_EVENT_NOTE)
          .set(CALENDAR_EVENT_NOTE.EVENT_ID, key.eventId())
          .set(
              CALENDAR_EVENT_NOTE.OCCURRENCE_START,
              key.occurrenceStart() == null ? null : toOffset(key.occurrenceStart()))
          .set(CALENDAR_EVENT_NOTE.WIKI_PAGE_ID, wikiPageId)
          .set(CALENDAR_EVENT_NOTE.LINKED_BY, linkedBy)
          .execute();
    } catch (DataIntegrityViolationException ex) {
      String msg = ex.getMostSpecificCause().getMessage();
      if (msg != null && msg.contains(NOTE_WIKI_PAGE_FK)) {
        throw new WikiPageNotFoundException(wikiPageId);
      }
      throw ex;
    }
  }

  /** 키의 연결을 지운다(노트는 그대로). 지운 줄 수. */
  public int delete(NoteKey key) {
    return dsl.deleteFrom(CALENDAR_EVENT_NOTE).where(keyCondition(key)).execute();
  }

  /** 일정의 회차 연결 중 {@code occurrence_start >= fromInclusive} 인 것을 지운다(「이 회차와 이후」 자르기). 지운 줄 수. */
  public int deleteFrom(long eventId, OffsetDateTime fromInclusive) {
    return dsl.deleteFrom(CALENDAR_EVENT_NOTE)
        .where(CALENDAR_EVENT_NOTE.EVENT_ID.eq(eventId))
        .and(CALENDAR_EVENT_NOTE.OCCURRENCE_START.ge(fromInclusive))
        .execute();
  }
}
