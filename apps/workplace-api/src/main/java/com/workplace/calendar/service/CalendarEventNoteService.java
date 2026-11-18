package com.workplace.calendar.service;

import com.workplace.calendar.dto.EventNoteRef;
import com.workplace.calendar.dto.NoteKey;
import com.workplace.calendar.dto.NoteLinkedEventResponse;
import com.workplace.calendar.dto.NoteLinkedEventsResponse;
import com.workplace.calendar.repository.CalendarEventExceptionRepository;
import com.workplace.calendar.repository.CalendarEventExceptionRepository.ExceptionRow;
import com.workplace.calendar.repository.CalendarEventNoteRepository;
import com.workplace.calendar.repository.CalendarEventNoteRepository.NoteLinkRow;
import com.workplace.calendar.repository.CalendarEventRepository;
import com.workplace.calendar.repository.CalendarEventRepository.NoteEventRow;
import com.workplace.calendar.repository.EventAttendeeRepository;
import com.workplace.global.util.AppWebLinks;
import com.workplace.wiki.dto.WikiPageCard;
import com.workplace.wiki.service.WikiPageReadAccess;
import java.time.Duration;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 일정 노트 연결을 응답 카드로 바꾼다(WP-1701). 연결 행은 calendar 가, 「이 사람이 그 노트를 읽을 수 있나」 판정과 카드 메타는 wiki 의 읽기 포트
 * {@link WikiPageReadAccess} 가 맡는다 — 목록에서도 연결 행 1번 + 판정 1번만 쓴다(N+1 금지).
 *
 * <p>카드 규칙: 읽을 수 있으면 제목·공간 등을 싣고, 읽을 수 없는 노트(없어진 것 제외 — 삭제는 CASCADE 로 연결도 사라진다)는 {@code restricted}
 * 만 싣는다. 읽을 수 있는 노트에는 웹 절대 주소({@link AppWebLinks#wikiPage}, WP-1704)를 싣는다 — AI 도구가 주소를 지어내지 않게.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class CalendarEventNoteService {
  /** 노트 하단 「연결된 일정」 상한(WP-1703) — 한 노트에 이어지는 일정은 보통 하나라 안전판. */
  static final int LINKED_EVENTS_LIMIT = 50;

  private final CalendarEventNoteRepository noteRepo;
  private final WikiPageReadAccess wikiAccess;
  private final AppWebLinks webLinks;
  private final CalendarEventRepository eventRepo;
  private final CalendarEventExceptionRepository exceptionRepo;
  private final EventAttendeeRepository attendeeRepo;
  private final RecurrenceExpander expander;

  /** 키 한 개의 카드. 연결이 없으면 null. 연결 한 줄만 읽는다(WP-1701). */
  public EventNoteRef cardFor(long callerId, NoteKey key) {
    return noteRepo
        .find(key)
        .map(l -> toCard(l, wikiAccess.readableCards(callerId, Set.of(l.wikiPageId()))))
        .orElse(null);
  }

  /** 키들의 카드를 한 번에 — 연결 행 조회 1번 + 노트 판정 1번. 연결이 없는 키는 결과에 없다. 연결은 있으나 읽을 수 없으면 restricted 카드. */
  public Map<NoteKey, EventNoteRef> cardsFor(long callerId, Collection<NoteKey> keys) {
    Map<NoteKey, EventNoteRef> out = new HashMap<>();
    if (keys == null || keys.isEmpty()) return out;
    // 요청한 키의 연결만 받는다(WP-1737) — 저장소가 좁은 범위로 읽은 뒤 요청하지 않은 회차 줄은 버리고 돌려준다.
    Map<NoteKey, NoteLinkRow> links = noteRepo.findByKeys(keys);
    if (links.isEmpty()) return out;
    Set<Long> pageIds = new HashSet<>();
    links.values().forEach(l -> pageIds.add(l.wikiPageId()));
    Map<Long, WikiPageCard> readable = wikiAccess.readableCards(callerId, pageIds);
    links.forEach((k, l) -> out.put(k, toCard(l, readable)));
    return out;
  }

  /**
   * 노트에 이어진 일정 목록(WP-1703) — 노트 하단 「연결된 일정」. 노트를 읽을 수 없으면 없는 노트와 같은 404({@link
   * WikiPageReadAccess#requireReadable}). 쿼리는 연결 줄 1번 + 일정 1번 + 예외 1번 + (있으면) override 일정 1번 + 참석 수
   * 1번으로 고정된다(N+1 금지).
   *
   * <p>거르기: 일정(마스터/행)이 호출자에게 보여야 하고(주인·참석자, 끊긴 외부 계정 달력 제외), 반복 회차 연결은 마스터가 아직 반복이고 RRULE 전개가 그 원래
   * 시작 시각을 내며 취소된 회차가 아니어야 한다. 「이 회차만」 옮긴 회차는 원래 자리로 세고, 보이는 값은 override 일정 것을 쓴다 — 마스터와 override 가
   * 둘 다 보여야 한다. 일정 목록은 override 를 그 자체 가시성으로 보여 주므로 이보다 넓다(override 에만 초대된 사람은 캘린더에서는 그 회차를 보지만 이
   * 패널에는 없다). 연결 키가 마스터에 걸려 있어 마스터를 못 보는 사람에게 그 연결을 드러내지 않는 쪽을 골랐다. 정렬은 시작 시각 내림차순, 최대 {@link
   * #LINKED_EVENTS_LIMIT}개.
   */
  @Transactional(readOnly = true)
  public NoteLinkedEventsResponse linkedEvents(long callerId, long pageId) {
    wikiAccess.requireReadable(callerId, pageId);
    List<NoteLinkRow> links = noteRepo.findByPageId(pageId);
    if (links.isEmpty()) return new NoteLinkedEventsResponse(List.of());

    // ① 이어진 일정(반복이면 마스터)을 호출자 가시성으로 한 번에 읽는다.
    Set<Long> eventIds = new HashSet<>();
    links.forEach(l -> eventIds.add(l.eventId()));
    Map<Long, NoteEventRow> events = byId(eventRepo.findVisibleSummaries(callerId, eventIds));

    // ② 회차 연결이 걸린 마스터들의 예외(취소·override)를 한 번에 읽는다.
    Set<Long> masterIds = new HashSet<>();
    for (NoteLinkRow l : links) {
      if (l.occurrenceStart() != null && events.containsKey(l.eventId())) {
        masterIds.add(l.eventId());
      }
    }
    Map<Long, Map<Instant, ExceptionRow>> exceptions = exceptionRepo.findByEvents(masterIds);

    // ③ 줄마다 살아 있는 회차인지 가리고, 값을 가져올 행(마스터 가상 회차·override·단일 행)을 정한다.
    List<Candidate> candidates = new ArrayList<>();
    Set<Long> overrideIds = new HashSet<>();
    for (NoteLinkRow l : links) {
      NoteEventRow ev = events.get(l.eventId());
      if (ev == null) continue; // 볼 수 없거나 사라진 일정
      if (l.occurrenceStart() == null) {
        // 반복 마스터 자체에는 회차 없는 키가 생기지 않는다 — 혹시 남은 줄은 회차를 특정할 수 없어 뺀다.
        if (ev.recurrenceRule() == null) candidates.add(new Candidate(ev, null, null));
        continue;
      }
      if (ev.recurrenceRule() == null || !stillExpands(ev, l.occurrenceStart())) continue;
      ExceptionRow ex = exceptions.getOrDefault(l.eventId(), Map.of()).get(l.occurrenceStart());
      if (ex != null && ex.cancelled()) continue;
      Long overrideId = ex == null ? null : ex.overrideEventId();
      if (overrideId != null) overrideIds.add(overrideId);
      candidates.add(new Candidate(ev, l.occurrenceStart(), overrideId));
    }

    // ④ override 일정을 같은 가시성으로 한 번에 읽는다(보이지 않는 override 의 회차는 뺀다).
    Map<Long, NoteEventRow> overrides = byId(eventRepo.findVisibleSummaries(callerId, overrideIds));

    // ⑤ 값을 가져올 행 id 를 모아 참석 수를 한 번에 센다.
    List<Resolved> resolved = new ArrayList<>();
    Set<Long> sourceIds = new HashSet<>();
    for (Candidate c : candidates) {
      Resolved r = resolve(c, overrides);
      if (r == null) continue;
      resolved.add(r);
      sourceIds.add(r.source().id());
    }
    Map<Long, Integer> counts = attendeeRepo.countByEvents(sourceIds);

    List<NoteLinkedEventResponse> items = new ArrayList<>(resolved.size());
    for (Resolved r : resolved) {
      items.add(
          new NoteLinkedEventResponse(
              r.eventId(),
              r.occurrenceStart() == null ? null : r.occurrenceStart().toString(),
              r.overrideEventId(),
              r.source().title(),
              r.startsAt(),
              r.endsAt(),
              r.source().allDay(),
              counts.getOrDefault(r.source().id(), 0)));
    }
    // 최근 일정 먼저 — 시각이 같으면 id 로 순서를 고정한다.
    items.sort(
        Comparator.comparing(NoteLinkedEventResponse::startsAt, Comparator.reverseOrder())
            .thenComparing(NoteLinkedEventResponse::eventId, Comparator.reverseOrder()));
    return new NoteLinkedEventsResponse(
        items.size() > LINKED_EVENTS_LIMIT ? items.subList(0, LINKED_EVENTS_LIMIT) : items);
  }

  /** 거르기를 지난 연결 한 줄(WP-1703) — occurrenceStart·overrideId 는 반복 회차일 때만. */
  private record Candidate(NoteEventRow event, Instant occurrenceStart, Long overrideId) {}

  /**
   * 응답 한 줄의 값 출처(WP-1703) — source 는 제목·종일·참석 수를 가져올 행, 시각은 회차에 맞춘 값. overrideEventId 는 옮긴 회차일 때만 —
   * 딥링크가 마스터가 아니라 그 회차(override 행)를 열게 한다.
   */
  private record Resolved(
      long eventId,
      Instant occurrenceStart,
      Long overrideEventId,
      NoteEventRow source,
      OffsetDateTime startsAt,
      OffsetDateTime endsAt) {}

  /**
   * 후보를 응답 값으로 푼다(WP-1703). 단일 행은 그대로, 옮긴 회차는 override 행(보이지 않으면 null — 뺀다), 그 밖의 회차는 마스터를 원래 시작
   * 시각으로 옮긴 가상 회차(길이는 마스터 길이, 일정 목록 전개와 같은 규칙).
   */
  private static Resolved resolve(Candidate c, Map<Long, NoteEventRow> overrides) {
    NoteEventRow ev = c.event();
    if (c.occurrenceStart() == null) {
      return new Resolved(ev.id(), null, null, ev, ev.startsAt(), ev.endsAt());
    }
    if (c.overrideId() != null) {
      NoteEventRow o = overrides.get(c.overrideId());
      return o == null
          ? null
          : new Resolved(ev.id(), c.occurrenceStart(), o.id(), o, o.startsAt(), o.endsAt());
    }
    OffsetDateTime start = OffsetDateTime.ofInstant(c.occurrenceStart(), ZoneOffset.UTC);
    Duration duration = Duration.between(ev.startsAt(), ev.endsAt());
    return new Resolved(ev.id(), c.occurrenceStart(), null, ev, start, start.plus(duration));
  }

  /**
   * 반복 마스터의 RRULE 전개가 아직 그 원래 시작 시각을 내는가(WP-1703) — 전체 수정으로 시작이 밀리면 옛 회차 키의 연결은 숨긴다. 판정은 회차 수정·삭제
   * 검증과 같은 {@link RecurrenceExpander#producesOccurrence}. 손상된 RRULE 은 그 줄만 뺀다.
   */
  private boolean stillExpands(NoteEventRow master, Instant occurrence) {
    try {
      return expander.producesOccurrence(master.recurrenceRule(), master.startsAt(), occurrence);
    } catch (RuntimeException e) {
      log.warn(
          "노트 연결 회차 전개 실패 — 건너뜀. eventId={}, rule={}", master.id(), master.recurrenceRule(), e);
      return false;
    }
  }

  /** 요약 목록을 id 맵으로(WP-1703). */
  private static Map<Long, NoteEventRow> byId(List<NoteEventRow> rows) {
    Map<Long, NoteEventRow> m = new HashMap<>();
    rows.forEach(r -> m.put(r.id(), r));
    return m;
  }

  /** 읽을 수 있는 노트면 카드(+ 노트 웹 주소, WP-1704), 아니면 restricted 카드(WP-1701). */
  private EventNoteRef toCard(NoteLinkRow link, Map<Long, WikiPageCard> readable) {
    WikiPageCard c = readable.get(link.wikiPageId());
    if (c == null) return EventNoteRef.restrictedRef();
    return EventNoteRef.of(c, webLinks.wikiPage(c.spaceId(), c.id()));
  }
}
