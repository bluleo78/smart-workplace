package com.workplace.calendar.service;

import com.workplace.calendar.dto.EventNoteRef;
import com.workplace.calendar.dto.NoteKey;
import com.workplace.calendar.repository.CalendarEventNoteRepository;
import com.workplace.calendar.repository.CalendarEventNoteRepository.NoteLinkRow;
import com.workplace.wiki.dto.WikiPageCard;
import com.workplace.wiki.service.WikiPageReadAccess;
import java.util.Collection;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

/**
 * 일정 노트 연결을 응답 카드로 바꾼다(WP-1701). 연결 행은 calendar 가, 「이 사람이 그 노트를 읽을 수 있나」 판정과 카드 메타는 wiki 의 읽기 포트
 * {@link WikiPageReadAccess} 가 맡는다 — 목록에서도 연결 행 1번 + 판정 1번만 쓴다(N+1 금지).
 *
 * <p>카드 규칙: 읽을 수 있으면 제목·공간 등을 싣고, 읽을 수 없는 노트(없어진 것 제외 — 삭제는 CASCADE 로 연결도 사라진다)는 {@code restricted}
 * 만 싣는다.
 */
@Service
@RequiredArgsConstructor
public class CalendarEventNoteService {
  private final CalendarEventNoteRepository noteRepo;
  private final WikiPageReadAccess wikiAccess;

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

  /** 읽을 수 있는 노트면 카드, 아니면 restricted 카드(WP-1701). */
  private static EventNoteRef toCard(NoteLinkRow link, Map<Long, WikiPageCard> readable) {
    WikiPageCard c = readable.get(link.wikiPageId());
    return c == null ? EventNoteRef.restrictedRef() : EventNoteRef.of(c);
  }
}
