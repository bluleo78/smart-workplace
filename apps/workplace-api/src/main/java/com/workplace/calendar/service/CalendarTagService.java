package com.workplace.calendar.service;

import com.workplace.calendar.CalendarPalette;
import com.workplace.calendar.dto.CalendarEventResponse;
import com.workplace.calendar.dto.CalendarTagRef;
import com.workplace.calendar.dto.CalendarTagRequest;
import com.workplace.calendar.dto.CalendarTagResponse;
import com.workplace.calendar.exception.CalendarEventNotFoundException;
import com.workplace.calendar.exception.CalendarTagDuplicateNameException;
import com.workplace.calendar.exception.CalendarTagNotFoundException;
import com.workplace.calendar.exception.ExternalEventTagNotSupportedException;
import com.workplace.calendar.exception.OutlookTagRenameNotAllowedException;
import com.workplace.calendar.repository.CalendarEventExceptionRepository;
import com.workplace.calendar.repository.CalendarEventExceptionRepository.MasterOccurrence;
import com.workplace.calendar.repository.CalendarEventRepository;
import com.workplace.calendar.repository.CalendarTagRepository;
import com.workplace.calendar.repository.CalendarTagRepository.TagRow;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import lombok.RequiredArgsConstructor;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 캘린더 태그 유스케이스(WP-714) — 사용자별 태그 CRUD, 일정에 태그 붙이기, 일정 응답에 호출자 태그 채우기.
 *
 * <p>태그는 사람마다 따로다: 같은 일정이라도 각자 자기 태그만 붙이고 본다. 반복 일정은 마스터에 붙이고, 가상 회차·고친 회차(오버라이드)는 마스터의 태그를 따른다.
 * 외부(M365) 일정의 태그는 Outlook 범주 동기화가 정하므로 앱에서 붙이지 못한다(WP-716 전까지).
 */
@Service
@RequiredArgsConstructor
public class CalendarTagService {
  /** 태그 이름 최대 길이(앞뒤 공백 제외). 사이드바·칩에서 읽히는 길이로 정했다 — Outlook 범주는 이 제한 없이 동기화된다. */
  static final int NAME_MAX = 50;

  private final CalendarTagRepository tagRepo;
  private final CalendarEventRepository eventRepo;
  private final CalendarEventExceptionRepository exceptionRepo;

  /** 내 태그 목록 — 이름순, 일정 수·구독 주소 여부 포함. */
  @Transactional(readOnly = true)
  public List<CalendarTagResponse> list(long callerId) {
    return tagRepo.listByUser(callerId);
  }

  /** 태그 만들기 — 이름 1~50자(공백 제외), 색은 팔레트 키(없으면 이름 해시). 같은 이름(대소문자 무시)이면 409. */
  @Transactional
  public CalendarTagResponse create(long callerId, CalendarTagRequest req) {
    String name = requireName(req.name());
    String color = req.color() == null ? CalendarPalette.forName(name) : requireColor(req.color());
    // 먼저 확인해 409 를 낸다 — 유니크 위반을 기다리면 트랜잭션이 깨져 같은 트랜잭션의 뒤 작업까지 실패한다. 경합은 아래 catch 가 받는다.
    if (tagRepo.existsName(callerId, name, null)) throw new CalendarTagDuplicateNameException();
    long id;
    try {
      id = tagRepo.insert(callerId, name, color);
    } catch (DuplicateKeyException e) {
      throw new CalendarTagDuplicateNameException();
    }
    return tagRepo.findResponse(callerId, id).orElseThrow(CalendarTagNotFoundException::new);
  }

  /**
   * 이름·색 바꾸기 — 보낸 필드만 바꾼다. 남의 태그·없는 태그는 404, 이름 충돌은 409. Outlook 범주에서 온 태그(OUTLOOK 연결이 있는 태그)의 이름을
   * 바꾸려 하면 409 — 동기화가 범주 이름으로 태그를 찾아, 앱에서 바꾼 이름은 다음 동기화에서 옛 이름 태그로 갈라지기 때문이다. 색은 바꿀 수 있다.
   */
  @Transactional
  public CalendarTagResponse update(long callerId, long tagId, CalendarTagRequest req) {
    TagRow current = requireOwned(callerId, tagId);
    // 이름이 그대로면 이름 검사를 건너뛴다 — Outlook 범주에서 온 50자 넘는 태그도 색만 바꿀 수 있어야 한다(화면은 늘 이름·색을 함께 보낸다).
    boolean sameName = req.name() == null || req.name().strip().equals(current.name());
    if (!sameName && tagRepo.hasOutlookLinks(tagId)) {
      throw new OutlookTagRenameNotAllowedException();
    }
    String name = sameName ? null : requireName(req.name());
    String color = req.color() == null ? null : requireColor(req.color());
    if (name != null && tagRepo.existsName(callerId, name, tagId)) {
      throw new CalendarTagDuplicateNameException();
    }
    try {
      tagRepo.update(tagId, name, color);
    } catch (DuplicateKeyException e) {
      throw new CalendarTagDuplicateNameException();
    }
    return tagRepo.findResponse(callerId, tagId).orElseThrow(CalendarTagNotFoundException::new);
  }

  /** 태그 지우기 — 일정 연결과 구독 주소도 함께 사라진다. 일정은 그대로. */
  @Transactional
  public void delete(long callerId, long tagId) {
    requireOwned(callerId, tagId);
    tagRepo.delete(tagId);
  }

  /**
   * 일정의 내 태그를 tagIds 로 바꾼다. 일정은 볼 수 있어야 하고(주인 또는 참석자 — 아니면 404), 태그는 모두 내 것이어야 한다(아니면 404). 고친 회차
   * id 면 마스터에 붙인다(가상 회차 id 는 이미 마스터 id). 외부(M365) 일정은 409. 다른 사람의 태그와 Outlook 범주 연결은 건드리지 않는다.
   */
  @Transactional
  public void setEventTags(long callerId, long eventId, List<Long> tagIds) {
    eventRepo
        .findById(callerId, eventId)
        .orElseThrow(() -> new CalendarEventNotFoundException(eventId));
    long masterId =
        exceptionRepo
            .findMasterOccurrenceByOverride(eventId)
            .map(MasterOccurrence::eventId)
            .orElse(eventId);
    boolean external =
        eventRepo.findExternalRef(masterId).map(r -> r.eventExternalId() != null).orElse(false);
    if (external) {
      throw new ExternalEventTagNotSupportedException();
    }
    Set<Long> wanted = new LinkedHashSet<>();
    for (Long id : tagIds) if (id != null) wanted.add(id);
    if (!tagRepo.ownedIds(callerId, wanted).containsAll(wanted)) {
      throw new CalendarTagNotFoundException();
    }
    tagRepo.replaceAppLinks(callerId, masterId, wanted);
  }

  /**
   * 일정 응답들에 호출자의 태그를 채운다 — 목록·상세가 같이 쓴다. 가상 회차는 masterEventId, 고친 회차는 예외 표의 마스터로 키를 바꿔 마스터의 태그를 따르게
   * 하고, 두 번의 배치 조회(오버라이드 역조회·태그)로 끝내 N+1 을 피한다. 호출자의 읽기 트랜잭션 안에서 부른다.
   */
  public List<CalendarEventResponse> withCallerTags(
      long callerId, List<CalendarEventResponse> events) {
    if (events.isEmpty()) return events;
    Set<Long> concreteIds = new HashSet<>();
    for (CalendarEventResponse e : events) {
      if (e.masterEventId() == null) concreteIds.add(e.id());
    }
    Map<Long, MasterOccurrence> overrides = exceptionRepo.mastersByOverrides(concreteIds);
    Set<Long> keys = new HashSet<>();
    for (CalendarEventResponse e : events) keys.add(tagKey(e, overrides));
    Map<Long, List<CalendarTagRef>> byEvent = tagRepo.tagsByEvents(callerId, keys);
    return events.stream()
        .map(e -> e.withTags(byEvent.getOrDefault(tagKey(e, overrides), List.of())))
        .toList();
  }

  /** 반복을 「이후 모든 일정」으로 나눠 새 마스터가 생길 때 옛 마스터의 태그(모든 사람 것)를 잇는다. 쓰기 트랜잭션 안에서 부른다. */
  public void copyTags(long fromEventId, long toEventId) {
    tagRepo.copyLinks(fromEventId, toEventId);
  }

  /** 태그를 찾을 일정 키 — 가상 회차는 마스터, 고친 회차는 예외 표의 마스터, 그 외는 자기 id. 구독 주소도 같은 규칙으로 거른다. */
  static long tagKey(CalendarEventResponse e, Map<Long, MasterOccurrence> overrides) {
    if (e.masterEventId() != null) return e.masterEventId();
    MasterOccurrence m = overrides.get(e.id());
    return m != null ? m.eventId() : e.id();
  }

  /** 주인 확인 — 남의 태그·없는 태그는 404(존재 은닉). 구독 주소 서비스(CalendarTagFeedService)도 같은 확인을 쓴다. */
  TagRow requireOwned(long callerId, long tagId) {
    return tagRepo.findOwned(callerId, tagId).orElseThrow(CalendarTagNotFoundException::new);
  }

  /** 이름 정리·검증 — 앞뒤 공백을 떼고 1~50자. */
  private static String requireName(String raw) {
    String name = Objects.requireNonNullElse(raw, "").strip();
    if (name.isEmpty() || name.length() > NAME_MAX) {
      throw new IllegalArgumentException("태그 이름은 1~" + NAME_MAX + "자로 입력하세요");
    }
    return name;
  }

  /** 색 검증 — 팔레트 키만. */
  private static String requireColor(String color) {
    if (!CalendarPalette.isValid(color)) {
      throw new IllegalArgumentException("허용되지 않은 색입니다");
    }
    return color;
  }
}
