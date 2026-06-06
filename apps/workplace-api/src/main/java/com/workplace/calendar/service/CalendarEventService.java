package com.workplace.calendar.service;

import com.workplace.calendar.dto.CalendarEventRequest;
import com.workplace.calendar.dto.CalendarEventResponse;
import com.workplace.calendar.exception.CalendarEventNotFoundException;
import com.workplace.calendar.repository.CalendarEventExceptionRepository;
import com.workplace.calendar.repository.CalendarEventRepository;
import com.workplace.calendar.repository.EventReminderRepository;
import java.time.Duration;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.Set;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** 개인 일정 CRUD 유스케이스. owner=호출자만 접근 가능(비-owner→404). */
@Service
@Slf4j
@RequiredArgsConstructor
public class CalendarEventService {
  private final CalendarEventRepository repo;
  private final EventReminderRepository reminderRepo;
  private final CalendarEventExceptionRepository exceptionRepo;
  private final RecurrenceExpander expander;

  /** 일정 생성 — owner=caller. RRULE 이 있으면 쓰기 시점에 검증(잘못된 규칙→400). */
  @Transactional
  public CalendarEventResponse create(long callerId, CalendarEventRequest req) {
    validateRecurrence(req.recurrenceRule());
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

  /**
   * owner 의 [from,to) 겹침 목록. 구체(비반복) 일정에 더해, 반복 마스터를 회차 전개해 가상 회차를 생성한다. 예외 행(취소/오버라이드)에 해당하는 회차는
   * 건너뛴다(오버라이드 실체는 별도 구체 일정으로 이미 포함됨). 시작 시각 오름차순 정렬.
   */
  @Transactional(readOnly = true)
  public List<CalendarEventResponse> list(long callerId, OffsetDateTime from, OffsetDateTime to) {
    List<CalendarEventResponse> result = new ArrayList<>(repo.listByRange(callerId, from, to));

    List<CalendarEventResponse> masters = repo.listRecurringMasters(callerId, to);
    if (!masters.isEmpty()) {
      // 마스터별 예외 회차 시각(Instant) 집합 — 문자열이 아닌 epoch-millis 로 비교.
      Map<Long, Set<Instant>> exceptions =
          exceptionRepo.occurrencesByEvent(
              masters.stream().map(CalendarEventResponse::id).toList());
      for (CalendarEventResponse m : masters) {
        // 마스터 1개의 손상된 RRULE 이 전체 조회를 죽이지 않도록 격리(로그 후 스킵). DB 레벨 손상 방어.
        try {
          Set<Instant> skip = exceptions.getOrDefault(m.id(), Collections.emptySet());
          Duration duration = Duration.between(m.startsAt(), m.endsAt());
          for (OffsetDateTime s : expander.expand(m.recurrenceRule(), m.startsAt(), from, to)) {
            if (skip.contains(s.toInstant())) {
              continue;
            }
            result.add(toOccurrence(m, s, duration));
          }
        } catch (RuntimeException e) {
          log.warn("반복 마스터 회차 전개 실패 — 건너뜀. eventId={}, rule={}", m.id(), m.recurrenceRule(), e);
        }
      }
    }

    result.sort(Comparator.comparing(CalendarEventResponse::startsAt));
    return result;
  }

  /** 마스터 + 회차 시작시각 → 가상 회차 응답. id 는 마스터 id 를 그대로 쓰고 masterEventId/occurrenceDate 로 회차를 식별한다. */
  private static CalendarEventResponse toOccurrence(
      CalendarEventResponse m, OffsetDateTime s, Duration duration) {
    return new CalendarEventResponse(
        m.id(),
        m.title(),
        m.description(),
        s,
        s.plus(duration),
        m.allDay(),
        m.location(),
        m.color(),
        m.reminderMinutes(),
        m.recurrenceRule(),
        m.id(),
        s.toString(),
        m.createdAt(),
        m.updatedAt());
  }

  /** 전체 교체 — 비-owner→404. RRULE 이 있으면 쓰기 시점에 검증(잘못된 규칙→400). */
  @Transactional
  public CalendarEventResponse update(long callerId, long id, CalendarEventRequest req) {
    requireOwner(callerId, id);
    validateRecurrence(req.recurrenceRule());
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

  /** RRULE 쓰기 검증 — 비어있지 않으면 파싱 시도(잘못된 규칙→IllegalArgumentException→400). null/공백은 단일 일정이라 통과. */
  private void validateRecurrence(String recurrenceRule) {
    if (recurrenceRule != null && !recurrenceRule.isBlank()) {
      expander.validate(recurrenceRule);
    }
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
