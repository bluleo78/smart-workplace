package com.workplace.calendar.service;

import com.workplace.calendar.outbound.CalendarChangeNotifier;
import com.workplace.calendar.repository.CalendarInviteEventRepository;
import com.workplace.calendar.repository.CalendarInviteEventRepository.InviteEventRow;
import com.workplace.calendar.repository.CalendarInviteEventRepository.InviteEventValues;
import com.workplace.calendar.repository.EventAttendeeRepository;
import com.workplace.global.realtime.ResourceChangedEvent;
import com.workplace.mail.outbound.MailInviteCalendarPort;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Locale;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

/**
 * 메일 초대 → 내 캘린더 반영(WP-986) — 메일 도메인의 {@link MailInviteCalendarPort} 구현.
 *
 * <p>IMAP 계정의 초대는 캘린더 동기화가 없으므로 응답할 때 앱 일정을 직접 만든다: 주인은 나(기본 캘린더), 주최자는 외부 이메일 ORGANIZER 행, 나는
 * ATTENDEE 행(응답 상태) — 그래서 일정 수정·삭제 가드(requireOrganizer)가 남의 미팅으로 보고 막는다. M365 계정은 동기화 사본이 이미 있으므로 내
 * 참석자 응답만 바꾼다. 호출자(메일 서비스)의 쓰기 트랜잭션 안에서 불린다.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class MailInviteCalendarAdapter implements MailInviteCalendarPort {

  /** 일정 제목·장소 상한 — calendar_event 컬럼(VARCHAR(200)). */
  private static final int TITLE_MAX = 200;

  /** 취소된 일정 제목 앞말. */
  static final String CANCELLED_PREFIX = "취소됨: ";

  private final CalendarInviteEventRepository inviteRepo;
  private final EventAttendeeRepository attendeeRepo;
  private final CalendarService calendarService;
  private final CalendarChangeNotifier changeNotifier;

  @Override
  public Optional<MyInviteEvent> findMyEvent(long userId, String uid) {
    return inviteRepo
        .findFirstOwnedByUid(userId, uid)
        .map(
            r ->
                new MyInviteEvent(
                    r.id(),
                    r.myResponse(),
                    r.sequence(),
                    r.cancelled(),
                    r.local(),
                    r.organizerEmail()));
  }

  @Override
  public Optional<Long> applyLocalResponse(
      long userId, String myEmail, InviteEventData event, String response) {
    return applyLocalResponse(userId, myEmail, event, response, true);
  }

  /**
   * @param retryOnConflict 넣기가 유일 인덱스에 걸리면(동시 수락으로 다른 요청이 먼저 넣음) 한 번 다시 읽어 고치는 길로 간다
   */
  private Optional<Long> applyLocalResponse(
      long userId,
      String myEmail,
      InviteEventData event,
      String response,
      boolean retryOnConflict) {
    // 같은 주인·UID 앱 일정은 V229 유일 인덱스로 많아야 하나
    Optional<InviteEventRow> existing =
        inviteRepo.findOwnedByUid(userId, event.uid()).stream()
            .filter(InviteEventRow::local)
            .findFirst();
    if (existing.isPresent()) {
      InviteEventRow r = existing.get();
      // 주최자가 다른 같은 UID 일정은 건드리지 않는다 — 다른 주소가 UID 를 흉내 낸 초대로 남의 일정을 덮어쓰지 못하게
      if (!sameOrganizer(r.organizerEmail(), event.organizerEmail())) {
        log.warn("주최자가 다른 같은 UID 일정이 있어 메일 초대 응답을 일정에 반영하지 않음 (eventId={})", r.id());
        return Optional.empty();
      }
      // 이 초대 SEQUENCE 이상으로 취소된 일정은 되살리지 않는다(같은 SEQUENCE 의 취소가 초대보다 우선)
      if (r.cancelled() && r.sequence() != null && r.sequence() >= event.sequence()) {
        return Optional.of(r.id());
      }
    }
    if ("DECLINED".equals(response)) {
      // 거절은 새로 넣지 않는다 — 넣어 둔 일정이 있으면 내 응답만 바꾼다
      existing.ifPresent(r -> setMyResponse(r.id(), userId, response));
      existing.ifPresent(r -> notifyChanged(r.id(), userId, ResourceChangedEvent.OP_UPDATED));
      return existing.map(InviteEventRow::id);
    }
    InviteEventValues values = toValues(event);
    if (existing.isPresent()) {
      long id = existing.get().id();
      inviteRepo.update(id, values);
      setMyResponse(id, userId, response);
      notifyChanged(id, userId, ResourceChangedEvent.OP_UPDATED);
      return Optional.of(id);
    }
    long calendarId = calendarService.ensureDefault(userId);
    Optional<Long> inserted = inviteRepo.insertIfAbsent(userId, calendarId, values);
    if (inserted.isEmpty()) {
      // 동시 수락 — 먼저 커밋된 일정을 다시 읽어 고친다(READ COMMITTED 라 다음 문장에서 보인다)
      if (!retryOnConflict) {
        throw new IllegalStateException("메일 초대 일정을 넣지도 찾지도 못함: uid 충돌");
      }
      return applyLocalResponse(userId, myEmail, event, response, false);
    }
    long id = inserted.get();
    if (event.organizerEmail() != null) {
      attendeeRepo.insertExternal(
          id, event.organizerEmail(), event.organizerName(), "ORGANIZER", "ACCEPTED");
    }
    attendeeRepo.insert(id, userId, null, "ATTENDEE", response);
    String me = myEmail == null ? null : myEmail.toLowerCase(Locale.ROOT);
    for (String email : event.attendeeEmails()) {
      // 나·주최자는 위에서 넣었다 — 나머지 참석자는 외부 이메일 행(응답은 모름)
      if (email.equals(me) || email.equalsIgnoreCase(event.organizerEmail())) continue;
      attendeeRepo.insertExternal(id, email, null, "ATTENDEE", "NEEDS_ACTION");
    }
    notifyChanged(id, userId, ResourceChangedEvent.OP_CREATED);
    return Optional.of(id);
  }

  @Override
  public int applySyncedResponse(long userId, String uid, String response) {
    int changed = 0;
    for (InviteEventRow r : inviteRepo.findOwnedByUid(userId, uid)) {
      if (r.local()) continue;
      // 동기화 사본에 내 행이 없으면(별칭으로 초대받음) 넣지 않는다 — 다음 동기화가 Graph 기준으로 맞춘다
      if (attendeeRepo.updateRsvp(r.id(), userId, response) > 0) {
        notifyChanged(r.id(), userId, ResourceChangedEvent.OP_UPDATED);
        changed++;
      }
    }
    return changed;
  }

  @Override
  public int cancelLocal(long userId, String uid, int sequence, String organizerEmail) {
    int changed = 0;
    for (InviteEventRow r : inviteRepo.findOwnedByUid(userId, uid)) {
      // 동기화 사본은 동기화가 지운다. 이미 취소됐거나 더 최신 초대로 넣은 일정이면 옛 취소 메일을 무시한다
      if (!r.local() || r.cancelled()) continue;
      // 그 일정의 주최자가 보낸 취소만 — 다른 주소가 UID 를 흉내 낸 취소 메일로 내 일정을 지우지 못하게
      if (!sameOrganizer(r.organizerEmail(), organizerEmail)) {
        log.warn("주최자가 다른 취소 메일 — 일정 취소 표시 안 함 (eventId={})", r.id());
        continue;
      }
      if (r.sequence() != null && r.sequence() > sequence) continue;
      String title =
          r.title().startsWith(CANCELLED_PREFIX) ? r.title() : CANCELLED_PREFIX + r.title();
      inviteRepo.markCancelled(r.id(), truncate(title, TITLE_MAX), sequence);
      notifyChanged(r.id(), userId, ResourceChangedEvent.OP_UPDATED);
      changed++;
    }
    return changed;
  }

  /** 두 주최자 이메일이 같은가(대소문자 무시). 어느 쪽이든 없으면 같지 않다 — 확인할 수 없는 주최자는 믿지 않는다. */
  static boolean sameOrganizer(String a, String b) {
    return a != null && b != null && a.equalsIgnoreCase(b);
  }

  /** 내 응답 — 참석자 행이 없으면 만든다. */
  private void setMyResponse(long eventId, long userId, String response) {
    if (attendeeRepo.updateRsvp(eventId, userId, response) == 0) {
      attendeeRepo.insert(eventId, userId, null, "ATTENDEE", response);
    }
  }

  /** 일정 변경 → 내 열린 캘린더 화면 갱신(resource.changed). 외부 참석자는 대상이 아니다. */
  private void notifyChanged(long eventId, long userId, String op) {
    changeNotifier.eventChanged(op, eventId, userId, List.of(userId), userId);
  }

  /** 초대 값 → 일정 값. 끝이 없거나 시작보다 앞서면 기본 길이(종일 1일, 그 외 1시간) — calendar_event 는 끝이 시작보다 뒤여야 한다. */
  static InviteEventValues toValues(InviteEventData e) {
    OffsetDateTime end = e.end();
    if (end == null || !end.isAfter(e.start())) {
      end = e.allDay() ? e.start().plusDays(1) : e.start().plusHours(1);
    }
    String title = e.summary() == null || e.summary().isBlank() ? "(제목 없음)" : e.summary();
    return new InviteEventValues(
        truncate(title, TITLE_MAX),
        e.start(),
        end,
        e.allDay(),
        truncate(e.location(), TITLE_MAX),
        e.uid(),
        e.sequence());
  }

  private static String truncate(String s, int max) {
    return s == null || s.length() <= max ? s : s.substring(0, max);
  }
}
