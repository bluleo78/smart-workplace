package com.workplace.calendar.service;

import com.workplace.calendar.dto.CalendarEventRequest;
import com.workplace.calendar.dto.CalendarEventResponse;
import com.workplace.calendar.exception.CalendarEventNotFoundException;
import com.workplace.calendar.repository.CalendarEventRepository;
import com.workplace.calendar.repository.EventReminderRepository;
import java.time.OffsetDateTime;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** 개인 일정 CRUD 유스케이스. owner=호출자만 접근 가능(비-owner→404). */
@Service
@RequiredArgsConstructor
public class CalendarEventService {
  private final CalendarEventRepository repo;
  private final EventReminderRepository reminderRepo;

  /** 일정 생성 — owner=caller. */
  @Transactional
  public CalendarEventResponse create(long callerId, CalendarEventRequest req) {
    long id = repo.insert(callerId, req);
    applyReminder(id, req.reminderMinutes());
    return get(callerId, id);
  }

  /** 단건 조회 — 비-owner→404. */
  @Transactional(readOnly = true)
  public CalendarEventResponse get(long callerId, long id) {
    requireOwner(callerId, id);
    return repo.findById(id).orElseThrow(() -> new CalendarEventNotFoundException(id));
  }

  /** owner 의 [from,to) 겹침 목록. */
  @Transactional(readOnly = true)
  public List<CalendarEventResponse> list(long callerId, OffsetDateTime from, OffsetDateTime to) {
    return repo.listByRange(callerId, from, to);
  }

  /** 전체 교체 — 비-owner→404. */
  @Transactional
  public CalendarEventResponse update(long callerId, long id, CalendarEventRequest req) {
    requireOwner(callerId, id);
    repo.update(id, req);
    applyReminder(id, req.reminderMinutes());
    return get(callerId, id);
  }

  /** 삭제 — 비-owner→404. event_reminder 는 FK ON DELETE CASCADE 로 함께 제거. */
  @Transactional
  public void delete(long callerId, long id) {
    requireOwner(callerId, id);
    repo.delete(id);
  }

  /** 리마인더 반영 — null 이면 제거, 값 있으면 upsert(저장 시 재무장). */
  private void applyReminder(long eventId, Integer reminderMinutes) {
    if (reminderMinutes == null) {
      reminderRepo.deleteByEvent(eventId);
    } else {
      reminderRepo.upsert(eventId, reminderMinutes);
    }
  }

  /** owner 검증 — 미존재/비-owner 모두 404(존재 은닉). */
  private void requireOwner(long callerId, long id) {
    long ownerId = repo.findOwnerId(id).orElseThrow(() -> new CalendarEventNotFoundException(id));
    if (ownerId != callerId) {
      throw new CalendarEventNotFoundException(id);
    }
  }
}
