package com.workplace.calendar.service;

import com.workplace.calendar.CalendarPalette;
import com.workplace.calendar.dto.CalendarRequest;
import com.workplace.calendar.dto.CalendarResponse;
import com.workplace.calendar.exception.CalendarNotFoundException;
import com.workplace.calendar.exception.DefaultCalendarDeletionException;
import com.workplace.calendar.exception.ReadOnlyCalendarException;
import com.workplace.calendar.repository.CalendarRepository;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** 개인 캘린더(컨테이너) 유스케이스. 소유자 전용 CRUD + 기본 캘린더 보장(ensureDefault) + 삭제 시맨틱. */
@Service
@RequiredArgsConstructor
public class CalendarService {
  private final CalendarRepository repo;

  /** 소유자의 캘린더 목록. 비어 있으면 기본 캘린더를 lazy 생성 후 반환(신규/제로-일정 유저). */
  @Transactional
  public List<CalendarResponse> list(long callerId) {
    ensureDefault(callerId);
    return repo.listByOwner(callerId);
  }

  /** 기본 캘린더 보장 — 없으면 생성하고, 기본 캘린더 id 를 반환한다. 일정 생성 chokepoint 가 호출. */
  @Transactional
  public long ensureDefault(long callerId) {
    return repo.findDefaultId(callerId)
        .orElseGet(() -> repo.insert(callerId, "기본", CalendarPalette.DEFAULT, true, 0));
  }

  /** 캘린더 생성 — 색 팔레트 검증, position 미지정 시 말미 배치. is_default=false. */
  @Transactional
  public CalendarResponse create(long callerId, CalendarRequest req) {
    validateColor(req.color());
    int pos = req.position() != null ? req.position() : repo.maxPosition(callerId) + 1;
    long id = repo.insert(callerId, req.name(), req.color(), false, pos);
    return repo.findByIdForOwner(callerId, id).orElseThrow(() -> new CalendarNotFoundException(id));
  }

  /** 캘린더 수정 — 소유 검증 + 읽기전용 거부 + 색 팔레트 검증. */
  @Transactional
  public CalendarResponse update(long callerId, long id, CalendarRequest req) {
    requireOwnedCalendar(callerId, id);
    if (repo.isReadOnly(id)) throw new ReadOnlyCalendarException(id);
    validateColor(req.color());
    repo.update(id, req.name(), req.color(), req.position());
    return repo.findByIdForOwner(callerId, id).orElseThrow(() -> new CalendarNotFoundException(id));
  }

  /** 캘린더 삭제 — 소유 검증 + 읽기전용 거부, 기본은 거부, 비기본은 소속 일정을 기본으로 이동 후 삭제(데이터 보존). */
  @Transactional
  public void delete(long callerId, long id) {
    requireOwnedCalendar(callerId, id);
    if (repo.isReadOnly(id)) throw new ReadOnlyCalendarException(id);
    if (repo.isDefault(id)) {
      throw new DefaultCalendarDeletionException();
    }
    long defaultId = ensureDefault(callerId);
    repo.moveEventsToCalendar(id, defaultId);
    repo.delete(id);
  }

  /** 소유 캘린더 검증 — 미존재/비소유 모두 404(존재 은닉). 일정 chokepoint 도 사용. */
  public void requireOwnedCalendar(long callerId, long calendarId) {
    long ownerId =
        repo.findOwnerId(calendarId).orElseThrow(() -> new CalendarNotFoundException(calendarId));
    if (ownerId != callerId) {
      throw new CalendarNotFoundException(calendarId);
    }
  }

  /**
   * 소유 + 쓰기가능(읽기전용 외부 컨테이너 아님) 검증. 일정 생성/이동 chokepoint 용.
   *
   * <p>외부 동기화 컨테이너는 owner_id = 동기화 유저이므로 소유 검증만으론 막히지 않는다. 읽기전용이면 추가로
   * ReadOnlyCalendarException(409) 을 던진다.
   */
  public void requireWritableCalendar(long callerId, long calendarId) {
    requireOwnedCalendar(callerId, calendarId);
    if (repo.isReadOnly(calendarId)) throw new ReadOnlyCalendarException(calendarId);
  }

  /** 색 팔레트 키 검증 — 미허용 색은 400. */
  private void validateColor(String color) {
    if (!CalendarPalette.isValid(color)) {
      throw new IllegalArgumentException("허용되지 않은 색입니다: " + color);
    }
  }
}
