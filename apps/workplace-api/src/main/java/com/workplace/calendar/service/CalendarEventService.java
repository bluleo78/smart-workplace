package com.workplace.calendar.service;

import com.workplace.calendar.dto.AttendeeResponse;
import com.workplace.calendar.dto.CalendarEventRequest;
import com.workplace.calendar.dto.CalendarEventResponse;
import com.workplace.calendar.dto.EditScope;
import com.workplace.calendar.exception.CalendarEventNotFoundException;
import com.workplace.calendar.outbound.CalendarAttendeeEvents.CalendarAttendeeInvitedEvent;
import com.workplace.calendar.outbound.CalendarAttendeeEvents.CalendarRsvpChangedEvent;
import com.workplace.calendar.repository.CalendarEventExceptionRepository;
import com.workplace.calendar.repository.CalendarEventRepository;
import com.workplace.calendar.repository.EventAttendeeRepository;
import com.workplace.calendar.repository.EventAttendeeRepository.AttendeeRow;
import com.workplace.calendar.repository.EventReminderRepository;
import com.workplace.user.dto.UserResponse;
import com.workplace.user.repository.UserRepository;
import java.time.Duration;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 개인 일정 CRUD 유스케이스. 읽기: owner 또는 event_attendee 참석자(가시성 역전). 쓰기(수정/삭제): owner 전용(requireOwner 유지).
 */
@Service
@Slf4j
@RequiredArgsConstructor
public class CalendarEventService {
  private final CalendarEventRepository repo;
  private final EventReminderRepository reminderRepo;
  private final CalendarEventExceptionRepository exceptionRepo;
  private final RecurrenceExpander expander;
  private final EventAttendeeRepository attendeeRepo;
  private final UserRepository userRepo;
  private final ApplicationEventPublisher eventPublisher;

  /**
   * 일정 생성 — owner=caller. RRULE 이 있으면 쓰기 시점에 검증(잘못된 규칙→400). 주최자 본인의 ORGANIZER/ACCEPTED 행을 자동 삽입하고,
   * 초대 참석자도 함께 추가한다.
   */
  @Transactional
  public CalendarEventResponse create(long callerId, CalendarEventRequest req) {
    validateRecurrence(req.recurrenceRule());
    long id = repo.insert(callerId, req);
    applyReminder(id, req.reminderMinutes());

    // 주최자 본인 행: 항상 ORGANIZER/ACCEPTED, invited_by=null.
    attendeeRepo.insert(id, callerId, null, "ORGANIZER", "ACCEPTED");

    // 초대 참석자 삽입(주최자 중복·null 건너뜀). AGENT 사용자는 ACCEPTED 강제, HUMAN 은 NEEDS_ACTION.
    for (Long uid : req.attendeeUserIdsOrEmpty()) {
      if (uid == null || uid == callerId) continue;
      String status = isAgent(uid) ? "ACCEPTED" : "NEEDS_ACTION";
      attendeeRepo.insert(id, uid, callerId, "ATTENDEE", status);
      // AGENT 는 인박스 알림 제외 — HUMAN 초대자에게만 발행.
      if (!isAgent(uid)) {
        eventPublisher.publishEvent(new CalendarAttendeeInvitedEvent(id, uid, callerId));
      }
    }
    return get(callerId, id);
  }

  /**
   * 단건 조회 — owner 또는 참석자면 반환, 그 외 404. repo.findById 의 accessibleBy 술어가 두 가지를 모두 처리하므로 requireOwner
   * 불필요. 전체 참석자 목록 포함(enrich).
   */
  @Transactional(readOnly = true)
  public CalendarEventResponse get(long callerId, long id) {
    CalendarEventResponse e =
        repo.findById(callerId, id).orElseThrow(() -> new CalendarEventNotFoundException(id));
    return enrichForGet(callerId, e);
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
    // 배치로 참석자 count/myRsvpStatus 채움 — attendees 는 null(경량)
    return enrichForList(callerId, result);
  }

  /**
   * 마스터 + 회차 시작시각 → 가상 회차 응답. id 는 마스터 id 를 그대로 쓰고 masterEventId/occurrenceDate 로 회차를 식별한다. 참석자
   * 정보(attendeeCount/myRsvpStatus/attendees)는 enrich 단계에서 채워지므로 기본값(0/null/null) 설정.
   */
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
        m.updatedAt(),
        0, // attendeeCount — enrichForList 에서 채워짐
        null, // myRsvpStatus — enrichForList 에서 채워짐
        null); // attendees — list 경량 응답이므로 null
  }

  /**
   * 일정 수정 — 비-owner→404. RRULE 검증(400). 단일 일정이거나 scope=ALL 이면 전체 교체(마스터 자체 수정). 반복 일정의 THIS/
   * THIS_AND_FOLLOWING 는 occurrenceDate 가 가리키는 회차를 기준으로 분기한다(id 는 마스터 id).
   */
  @Transactional
  public CalendarEventResponse update(
      long callerId,
      long id,
      CalendarEventRequest req,
      EditScope scope,
      OffsetDateTime occurrenceDate) {
    requireOwner(callerId, id);
    validateRecurrence(req.recurrenceRule());
    // requireOwner 통과 후 조회: owner 이므로 accessibleBy 술어 만족 보장.
    CalendarEventResponse target =
        repo.findById(callerId, id).orElseThrow(() -> new CalendarEventNotFoundException(id));

    // 단일 일정 또는 ALL → 마스터 행 전체 교체(RRULE 포함). 기존 예외는 유지(v1b 한계).
    if (target.recurrenceRule() == null || scope == EditScope.ALL) {
      repo.update(id, req);
      applyReminder(id, req.reminderMinutes());
      return get(callerId, id);
    }
    requireOccurrenceDate(scope, occurrenceDate);

    if (scope == EditScope.THIS) {
      return updateThisOccurrence(callerId, id, req, occurrenceDate);
    }
    return updateFollowing(callerId, target, req, occurrenceDate);
  }

  /**
   * THIS 수정 — 회차를 대체할 독립 일정(RRULE=null, owner=마스터 owner)을 만들고 예외 행에 오버라이드로 연결한다. 이미 오버라이드가 있으면 중복
   * 생성 대신 그 일정을 갱신한다(고아 방지). 리마인더는 create 와 동일 경로로 부여. 신규 생성된 오버라이드에는 마스터의 참석자를 복사한다.
   */
  private CalendarEventResponse updateThisOccurrence(
      long callerId, long masterId, CalendarEventRequest req, OffsetDateTime occurrenceDate) {
    CalendarEventRequest overrideReq = withoutRecurrence(req);
    // 신규 생성 여부 추적 — 기존 오버라이드 갱신 시에는 참석자를 재복사하지 않는다(이미 보유).
    boolean[] isNew = {false};
    long overrideId =
        exceptionRepo
            .findOverrideEventId(masterId, occurrenceDate)
            .map(
                existing -> {
                  repo.update(existing, overrideReq);
                  return existing;
                })
            .orElseGet(
                () -> {
                  isNew[0] = true;
                  return repo.insert(callerId, overrideReq);
                });
    applyReminder(overrideId, req.reminderMinutes());
    exceptionRepo.upsertOverride(masterId, occurrenceDate, overrideId);
    // 신규 오버라이드 행에만 마스터의 참석자(ORGANIZER 포함)를 복제. role/rsvp_status/invited_by 보존.
    if (isNew[0]) {
      copyAttendees(masterId, overrideId);
    }
    return get(callerId, overrideId);
  }

  /**
   * THIS_AND_FOLLOWING 수정 — 시리즈를 occurrenceDate 직전(UNTIL=occ-1s)에서 자르고, occurrenceDate 부터 시작하는 새
   * 마스터를 req(변경된 RRULE 포함)로 생성한다. 잘린 구간의 예외 행과 그 오버라이드 별도 일정까지 제거해 새 마스터 재전개와의 중복(고아 ghost)을 막는다.
   * 분할된 새 마스터에는 기존 마스터의 참석자(ORGANIZER 포함)를 복제한다. 반환은 새 마스터.
   */
  private CalendarEventResponse updateFollowing(
      long callerId,
      CalendarEventResponse master,
      CalendarEventRequest req,
      OffsetDateTime occurrenceDate) {
    String truncated =
        RecurrenceExpander.withUntil(master.recurrenceRule(), occurrenceDate.minusSeconds(1));
    repo.updateRecurrenceRule(master.id(), truncated);
    long newMasterId = repo.insert(callerId, req);
    applyReminder(newMasterId, req.reminderMinutes());
    truncateExceptionsFrom(master.id(), occurrenceDate);
    // 기존 마스터의 참석자(ORGANIZER 포함)를 새 마스터에 복제. role/rsvp_status/invited_by 보존.
    copyAttendees(master.id(), newMasterId);
    return get(callerId, newMasterId);
  }

  /**
   * occurrenceDate 이후 예외 행 + 그 오버라이드 별도 일정 정리(FOLLOWING 수정/삭제 공용). 예외 행만 지우면 오버라이드 일정이 고아로 남아 새 회차와
   * 중복 표시되므로, 잘려나가는 오버라이드 id 를 먼저 수집해 함께 삭제한다.
   */
  private void truncateExceptionsFrom(long masterId, OffsetDateTime occurrenceDate) {
    List<Long> orphanedOverrides = exceptionRepo.overrideEventIdsFrom(masterId, occurrenceDate);
    exceptionRepo.deleteFromOccurrence(masterId, occurrenceDate);
    repo.deleteAllById(orphanedOverrides);
  }

  /**
   * 일정 삭제 — 비-owner→404. 단일 일정이거나 scope=ALL 이면 마스터 삭제(예외·리마인더 cascade). 오버라이드 별도 일정은 cascade 되지
   * 않으므로 직접 제거. THIS=회차 취소, THIS_AND_FOLLOWING=시리즈 잘라내기.
   */
  @Transactional
  public void delete(long callerId, long id, EditScope scope, OffsetDateTime occurrenceDate) {
    requireOwner(callerId, id);
    // requireOwner 통과 후 조회: owner 이므로 accessibleBy 술어 만족 보장.
    CalendarEventResponse target =
        repo.findById(callerId, id).orElseThrow(() -> new CalendarEventNotFoundException(id));

    if (target.recurrenceRule() == null || scope == EditScope.ALL) {
      // 마스터에 매달린 오버라이드 일정들은 FK 가 master→exception 방향이라 cascade 되지 않음 — 먼저 수집해 직접 삭제.
      List<Long> overrides = exceptionRepo.overrideEventIds(id);
      repo.delete(id);
      repo.deleteAllById(overrides);
      return;
    }
    requireOccurrenceDate(scope, occurrenceDate);

    if (scope == EditScope.THIS) {
      // 이미 오버라이드가 있던 회차를 취소하면 예외 행은 cancel 로 repoint 되지만 오버라이드 별도 일정은 남는다 → 고아 ghost 방지로 먼저 삭제.
      exceptionRepo.findOverrideEventId(id, occurrenceDate).ifPresent(repo::delete);
      exceptionRepo.insertCancellation(id, occurrenceDate);
      return;
    }
    // THIS_AND_FOLLOWING — UNTIL 로 시리즈를 자르고 잘린 구간의 예외·오버라이드 일정 정리.
    String truncated =
        RecurrenceExpander.withUntil(target.recurrenceRule(), occurrenceDate.minusSeconds(1));
    repo.updateRecurrenceRule(id, truncated);
    truncateExceptionsFrom(id, occurrenceDate);
  }

  /**
   * 주최자만 참석자 추가. AGENT 사용자는 ACCEPTED 강제, HUMAN 은 NEEDS_ACTION. caller 자신·null 은 건너뜀. HUMAN 초대자에게
   * CALENDAR_INVITED 알림 이벤트 발행.
   */
  @Transactional
  public void inviteAttendees(long callerId, long eventId, List<Long> userIds) {
    requireOwner(callerId, eventId); // 비주최자 → CalendarEventNotFoundException(404 은닉)
    for (Long uid : userIds) {
      if (uid == null || uid == callerId) continue;
      String status = isAgent(uid) ? "ACCEPTED" : "NEEDS_ACTION";
      attendeeRepo.insert(eventId, uid, callerId, "ATTENDEE", status);
      // AGENT 는 인박스 알림 제외 — HUMAN 초대자에게만 발행.
      if (!isAgent(uid)) {
        eventPublisher.publishEvent(new CalendarAttendeeInvitedEvent(eventId, uid, callerId));
      }
    }
  }

  /** 주최자만 참석자 제거. 주최자 본인 행(ORGANIZER)은 제거 불가 — 역할 보호. 등록되지 않은 사용자는 0행 삭제로 무시. */
  @Transactional
  public void removeAttendee(long callerId, long eventId, long userId) {
    requireOwner(callerId, eventId); // 비주최자 → CalendarEventNotFoundException(404 은닉)
    if (userId == callerId) return; // 주최자 본인 행 보호
    attendeeRepo.deleteByEventAndUser(eventId, userId);
  }

  /**
   * 본인 RSVP 변경. 참석자 행이 없으면 비가시(404). 변경 성공 시 주최자에게 CALENDAR_RSVP_CHANGED 알림 이벤트 발행(self-notify 는
   * NotificationService 에서 스킵).
   */
  @Transactional
  public void respondRsvp(long callerId, long eventId, String status) {
    int updated = attendeeRepo.updateRsvp(eventId, callerId, status);
    // 참석자 아님 → 이벤트 존재 자체를 은닉(404)
    if (updated == 0) throw new CalendarEventNotFoundException(eventId);
    // 주최자에게 RSVP 변경 알림 발행(주최자==caller 이면 self-notify — service 에서 skip).
    repo.findOwnerId(eventId)
        .ifPresent(
            ownerId ->
                eventPublisher.publishEvent(
                    new CalendarRsvpChangedEvent(eventId, ownerId, callerId)));
  }

  /**
   * list() 용 경량 enrich: 마스터 id 집합으로 단일 배치 조회 → count/myStatus 채움. attendees=null(전체 목록 미포함). 가상 회차는
   * masterEventId 키를 사용(마스터와 동일 참석자 공유).
   */
  private List<CalendarEventResponse> enrichForList(
      long callerId, List<CalendarEventResponse> events) {
    if (events.isEmpty()) return events;
    // 가상 회차는 masterEventId 를 키로 사용(마스터 참석자 집합 공유)
    Set<Long> masterIds =
        events.stream()
            .map(e -> e.masterEventId() != null ? e.masterEventId() : e.id())
            .collect(Collectors.toSet());
    Map<Long, List<AttendeeRow>> byEvent =
        attendeeRepo.findByEvents(masterIds).stream()
            .collect(Collectors.groupingBy(AttendeeRow::eventId));
    return events.stream()
        .map(
            e -> {
              long key = e.masterEventId() != null ? e.masterEventId() : e.id();
              var rows = byEvent.getOrDefault(key, List.of());
              int count = rows.size();
              String mine =
                  rows.stream()
                      .filter(r -> r.userId() == callerId)
                      .map(AttendeeRow::rsvpStatus)
                      .findFirst()
                      .orElse(null);
              return withAttendeeInfo(e, count, mine, null);
            })
        .toList();
  }

  /** get() 용 전체 enrich: 마스터(또는 구체) id 로 단건 조회 → 전체 참석자 목록 포함. 가상 회차는 masterEventId 키 사용. */
  private CalendarEventResponse enrichForGet(long callerId, CalendarEventResponse e) {
    long key = e.masterEventId() != null ? e.masterEventId() : e.id();
    var rows = attendeeRepo.findByEvent(key);
    String mine =
        rows.stream()
            .filter(r -> r.userId() == callerId)
            .map(AttendeeRow::rsvpStatus)
            .findFirst()
            .orElse(null);
    var dtos =
        rows.stream()
            .map(
                r ->
                    new AttendeeResponse(
                        r.userId(),
                        r.username(),
                        r.name(),
                        r.kind(),
                        r.role(),
                        r.rsvpStatus(),
                        r.invitedByUserId()))
            .toList();
    return withAttendeeInfo(e, rows.size(), mine, dtos);
  }

  /**
   * CalendarEventResponse 레코드를 복사하며 참석자 3필드(attendeeCount/myRsvpStatus/attendees)만 교체. Java record
   * 는 with-copy 미지원이므로 명시적 생성.
   */
  private static CalendarEventResponse withAttendeeInfo(
      CalendarEventResponse e, int count, String myRsvpStatus, List<AttendeeResponse> attendees) {
    return new CalendarEventResponse(
        e.id(),
        e.title(),
        e.description(),
        e.startsAt(),
        e.endsAt(),
        e.allDay(),
        e.location(),
        e.color(),
        e.reminderMinutes(),
        e.recurrenceRule(),
        e.masterEventId(),
        e.occurrenceDate(),
        e.createdAt(),
        e.updatedAt(),
        count,
        myRsvpStatus,
        attendees);
  }

  /**
   * 참석자 복사 — fromEventId 의 모든 참석자 행(ORGANIZER 포함)을 toEventId 에 그대로 복제한다. role, rsvp_status,
   * invited_by 를 보존하여 오버라이드/분할 이후에도 참석자 구성이 유지되도록 한다.
   */
  private void copyAttendees(long fromEventId, long toEventId) {
    for (AttendeeRow a : attendeeRepo.findByEvent(fromEventId)) {
      attendeeRepo.insert(toEventId, a.userId(), a.invitedByUserId(), a.role(), a.rsvpStatus());
    }
  }

  /** 반복 일정의 THIS/THIS_AND_FOLLOWING 는 회차 식별자(occurrenceDate)가 필수 — 누락 시 400. */
  private static void requireOccurrenceDate(EditScope scope, OffsetDateTime occurrenceDate) {
    if (occurrenceDate == null) {
      throw new IllegalArgumentException("occurrenceDate required for THIS/THIS_AND_FOLLOWING");
    }
  }

  /** 오버라이드 일정은 단일 일정이어야 하므로 RRULE 을 제거한 요청 복제. */
  private static CalendarEventRequest withoutRecurrence(CalendarEventRequest req) {
    return new CalendarEventRequest(
        req.title(),
        req.description(),
        req.startsAt(),
        req.endsAt(),
        req.allDay(),
        req.location(),
        req.color(),
        req.reminderMinutes(),
        null,
        null); // 오버라이드 일정은 단일이므로 참석자 인수 제거
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

  /** owner 검증 — 미존재/비-owner 모두 404(존재 은닉). 쓰기 경로(수정/삭제)에서만 사용. */
  private void requireOwner(long callerId, long id) {
    long ownerId = repo.findOwnerId(id).orElseThrow(() -> new CalendarEventNotFoundException(id));
    if (ownerId != callerId) {
      throw new CalendarEventNotFoundException(id);
    }
  }

  /** 사용자 kind == 'AGENT' 여부 판정 — 초대 참석자 RSVP 초기값 결정에 사용. 존재하지 않는 userId 면 false(비공개 404 유지). */
  private boolean isAgent(long userId) {
    return userRepo.findById(userId).map(UserResponse::kind).map("AGENT"::equals).orElse(false);
  }
}
