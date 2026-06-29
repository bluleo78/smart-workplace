package com.workplace.calendar.service;

import com.workplace.calendar.dto.AttendeeResponse;
import com.workplace.calendar.dto.CalendarEventRequest;
import com.workplace.calendar.dto.CalendarEventResponse;
import com.workplace.calendar.dto.EditScope;
import com.workplace.calendar.exception.CalendarEventNotFoundException;
import com.workplace.calendar.exception.ExternalCalendarWriteInTransactionException;
import com.workplace.calendar.exception.ExternalEventMoveNotSupportedException;
import com.workplace.calendar.exception.ReadOnlyCalendarException;
import com.workplace.calendar.exception.RecurringNotSupportedOnExternalCalendarException;
import com.workplace.calendar.outbound.CalendarAttendeeEvents.CalendarAttendeeInvitedEvent;
import com.workplace.calendar.outbound.CalendarAttendeeEvents.CalendarRsvpChangedEvent;
import com.workplace.calendar.repository.CalendarEventExceptionRepository;
import com.workplace.calendar.repository.CalendarEventRepository;
import com.workplace.calendar.repository.CalendarRepository;
import com.workplace.calendar.repository.EventAttendeeRepository;
import com.workplace.calendar.repository.EventAttendeeRepository.AttendeeRow;
import com.workplace.calendar.repository.EventReminderRepository;
import com.workplace.mail.dto.EmailAccountResponse;
import com.workplace.mail.dto.MailProvider;
import com.workplace.mail.outbound.GraphCalendarClient.GraphDateTime;
import com.workplace.mail.outbound.GraphCalendarClient.GraphEventWrite;
import com.workplace.mail.outbound.GraphCalendarClient.GraphItemBody;
import com.workplace.mail.outbound.GraphCalendarClient.GraphLocation;
import com.workplace.mail.repository.EmailAccountRepository;
import com.workplace.user.dto.UserResponse;
import com.workplace.user.repository.UserRepository;
import java.time.Duration;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;
import lombok.extern.slf4j.Slf4j;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 개인 일정 CRUD 유스케이스. 읽기: owner 또는 event_attendee 참석자(가시성 역전). 쓰기(수정/삭제): owner 전용(requireOwner 유지).
 */
@Service
@Slf4j
public class CalendarEventService {
  private final CalendarEventRepository repo;
  private final EventReminderRepository reminderRepo;
  private final CalendarEventExceptionRepository exceptionRepo;
  private final RecurrenceExpander expander;
  private final EventAttendeeRepository attendeeRepo;
  private final UserRepository userRepo;
  private final ApplicationEventPublisher eventPublisher;
  private final CalendarService calendarService;
  private final CalendarRepository calendarRepo;
  private final EmailAccountRepository emailAccountRepo;
  // 일정 역동기화 전송기 목록 — 공급자별 분기는 호출 시점에 transportFor 로 해소(구성 시 캐싱 금지).
  private final List<CalendarTransport> transports;
  // 비-@Transactional 오케스트레이터의 모든 DB 접근을 감싸는 트랜잭션 템플릿(GraphCalendarFetcher 패턴).
  private final TransactionTemplate txTemplate;

  /**
   * 명시적 생성자 — TransactionTemplate 을 PlatformTransactionManager 로 구성해야 하므로 @RequiredArgsConstructor
   * 를 쓰지 않는다. 기존 의존성 전부 + 신규(calendarRepo/emailAccountRepo/transports/txTemplate)를 대입한다.
   */
  public CalendarEventService(
      CalendarEventRepository repo,
      EventReminderRepository reminderRepo,
      CalendarEventExceptionRepository exceptionRepo,
      RecurrenceExpander expander,
      EventAttendeeRepository attendeeRepo,
      UserRepository userRepo,
      ApplicationEventPublisher eventPublisher,
      CalendarService calendarService,
      CalendarRepository calendarRepo,
      EmailAccountRepository emailAccountRepo,
      List<CalendarTransport> transports,
      PlatformTransactionManager txManager) {
    this.repo = repo;
    this.reminderRepo = reminderRepo;
    this.exceptionRepo = exceptionRepo;
    this.expander = expander;
    this.attendeeRepo = attendeeRepo;
    this.userRepo = userRepo;
    this.eventPublisher = eventPublisher;
    this.calendarService = calendarService;
    this.calendarRepo = calendarRepo;
    this.emailAccountRepo = emailAccountRepo;
    this.transports = transports;
    this.txTemplate = new TransactionTemplate(txManager);
  }

  /**
   * 일정 생성 — 외부 쓰기 캘린더면 Graph 로 write-through(동기) 후 external_id 동반 저장, 그 외 순수 로컬.
   *
   * <p>비-@Transactional 오케스트레이터: resolve(tx) → Graph HTTP(tx 밖) → persist(tx). HTTP 를 tx 안에서 호출하면
   * 커넥션 점유(#232)·RLS GUC 부재(#492). 모든 DB 접근은 txTemplate 안에서만 수행한다. Graph 실패는 persist 진입 전에 던져지므로 로컬
   * 행이 남지 않는다.
   */
  public CalendarEventResponse create(long callerId, CalendarEventRequest req) {
    validateRecurrence(req.recurrenceRule());
    validateColorOverride(req.color());

    // ① resolve — 대상 캘린더 분류(tx 안: requireWritableCalendar 의 RLS·소유/RO 검증 + 외부 참조 로드)
    WriteTarget target = txTemplate.execute(s -> resolveWriteTarget(callerId, req));

    // ② 외부 쓰기 → Graph HTTP (tx 밖)
    String externalId = null;
    if (target.externalWritable()) {
      // 가드: 이 지점은 오케스트레이터의 txTemplate '밖'이므로 활성 tx == 호출자(AI·채팅)의 ambient tx 다.
      // 호출자 tx 가 열려 있으면 REQUIRED txTemplate 이 그 tx 에 합류해 아래 Graph HTTP 가 tx 안에서 실행된다
      // (#232 커넥션 점유, "HTTP 는 어떤 tx 안에서도 금지" 위반). 정식 수정(confirm 서비스 @Transactional 범위
      // 축소)은 후속 #548. 그때까지는 Graph HTTP 도달 전에 차단한다.
      if (TransactionSynchronizationManager.isActualTransactionActive()) {
        throw new ExternalCalendarWriteInTransactionException();
      }
      if (req.recurrenceRule() != null && !req.recurrenceRule().isBlank()) {
        throw new RecurringNotSupportedOnExternalCalendarException();
      }
      externalId =
          transportFor(target.account().provider())
              .createEvent(
                  callerId, target.account(), target.externalCalendarId(), toGraphWrite(req));
    }

    // ③ persist — 로컬 저장(+최종 조회). external_id 동반이면 prune 안전.
    final String extId = externalId;
    return txTemplate.execute(s -> doCreateLocal(callerId, target.calendarId(), req, extId));
  }

  /** create 의 로컬 저장 단계 — 기존 create 본문 + external_id 동반 insert 분기. txTemplate 안에서만 호출. */
  private CalendarEventResponse doCreateLocal(
      long callerId, long calendarId, CalendarEventRequest req, String externalId) {
    long id =
        (externalId == null)
            ? repo.insert(callerId, calendarId, req)
            : repo.insertWithExternalId(callerId, calendarId, req, externalId);
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

  /** 생성 대상 분류 — calendarId resolve + 외부 쓰기 캘린더면 account/externalId 동반. txTemplate 안에서만 호출. */
  private WriteTarget resolveWriteTarget(long callerId, CalendarEventRequest req) {
    long calendarId = resolveCalendarId(callerId, req.calendarId()); // 소유/RO(409) 검증
    var ext = calendarRepo.findExternalRef(calendarId).orElse(null);
    if (ext == null || ext.externalAccountId() == null) {
      return new WriteTarget(calendarId, false, null, null);
    }
    // 외부 쓰기 캘린더 — 계정 로드(토큰/전송기 식별). 계정 없으면 로컬로 폴백(외부 전송 불가).
    EmailAccountResponse account =
        emailAccountRepo.findByIdAndUser(callerId, ext.externalAccountId()).orElse(null);
    if (account == null) {
      return new WriteTarget(calendarId, false, null, null);
    }
    return new WriteTarget(calendarId, true, account, ext.externalId());
  }

  /** 공급자 전송기 조회 — 호출 시점 해소(구성 시 캐싱 금지). 미지원이면 IllegalStateException(라우팅 누락 가드). */
  private CalendarTransport transportFor(MailProvider provider) {
    return transports.stream()
        .filter(t -> t.provider() == provider)
        .findFirst()
        .orElseThrow(() -> new IllegalStateException("일정 역동기화 전송기 없음: " + provider));
  }

  /** 로컬 일정 → Graph 쓰기 페이로드. 종일은 저장값 그대로(half-open), 시각은 UTC dateTime+timeZone. 참석자·반복 미포함. */
  private GraphEventWrite toGraphWrite(CalendarEventRequest req) {
    GraphItemBody body =
        (req.description() == null || req.description().isBlank())
            ? null
            : new GraphItemBody("text", req.description());
    GraphLocation location =
        (req.location() == null || req.location().isBlank())
            ? null
            : new GraphLocation(req.location());
    return new GraphEventWrite(
        req.title(),
        body,
        toGraphDateTime(req.startsAt(), req.allDay()),
        toGraphDateTime(req.endsAt(), req.allDay()),
        req.allDay(),
        location,
        null); // 참석자는 별도 patchAttendees 로 전송 (#547)
  }

  /**
   * OffsetDateTime → Graph dateTimeTimeZone(UTC).
   *
   * <p><b>시각(allDay=false)</b>: 오프셋 제거한 instant 의 LocalDateTime + timeZone="UTC".
   *
   * <p><b>종일(allDay=true)</b>: Graph 는 종일 start/end 가 자정(00:00:00)이길 요구한다. 그런데 사용자가 만든 종일 일정은 "현지
   * 자정"을 instant 로 저장하므로(KST 종일 "2026-07-10" → 저장값 {@code 2026-07-09T15:00:00Z}) 그대로 보내면 비-자정값이 되어
   * Graph 400 → 502. 핵심: 종일이라는 사실(all_day 플래그)만으로 원래 시각이 현지 자정이었음을 알 수 있고, 저장된 UTC 시각(시·분)은 생성자의
   * 오프셋을 인코딩한다. 따라서 외부 타임존 소스 없이도, 저장 instant 에 +12시간을 더해 가장 가까운 UTC 자정으로 반올림하면 의도한 캘린더 날짜가
   * 복원된다(±12h 안의 일반 오프셋에서 정확; KST +09 는 충분히 안쪽). start·end 모두 동일 규칙으로 반올림하므로 앱의 half-open
   * [start,end) 가 보존된다(1일 종일 → 날짜 D / D+1).
   */
  private static GraphDateTime toGraphDateTime(OffsetDateTime t, boolean allDay) {
    if (allDay) {
      java.time.LocalDate d = t.withOffsetSameInstant(ZoneOffset.UTC).plusHours(12).toLocalDate();
      // LocalDate.toString() 은 항상 zero-padded yyyy-MM-dd. 초 생략 회피 위해 "T00:00:00" 명시.
      return new GraphDateTime(d + "T00:00:00", "UTC");
    }
    return new GraphDateTime(
        t.withOffsetSameInstant(ZoneOffset.UTC).toLocalDateTime().toString(), "UTC");
  }

  /** 쓰기 대상 분류 결과 — externalWritable 이면 Graph 역동기화 경로. */
  private record WriteTarget(
      long calendarId,
      boolean externalWritable,
      EmailAccountResponse account,
      String externalCalendarId) {}

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
        m.calendarId(),
        m.calendarName(),
        m.effectiveColor(),
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
   * 일정 수정 — 외부 동기화 일정이면 Graph PATCH(필드 수정만) 후 로컬 반영, 그 외 기존 로컬 로직(반복 scope 포함).
   *
   * <p>비-@Transactional 오케스트레이터: resolve(tx) → Graph HTTP(tx 밖) → persist(tx). create 와 동일한 3단계로
   * HTTP 를 어떤 tx 안에서도 호출하지 않는다(#232 커넥션 점유, #492 GUC 부재 회피). Graph 실패는 persist 진입 전에 던져지므로 로컬 행이
   * 변경되지 않는다. 외부 일정은 단일(recurrence_rule=null)이므로 scope 분기는 로컬 경로에서만 의미. 외부 일정에 반복 전환·캘린더 이동은 미지원(둘
   * 다 422 로 명시 차단 — 조용한 무시 아님).
   */
  public CalendarEventResponse update(
      long callerId,
      long id,
      CalendarEventRequest req,
      EditScope scope,
      OffsetDateTime occurrenceDate) {
    validateRecurrence(req.recurrenceRule());
    validateColorOverride(req.color());

    // ① resolve — owner(404)·RO(409) 검증 + 외부 참조 + 현재 소속 캘린더(이동 차단용). requireWritableEvent 는 RO
    // 캘린더(공휴일)만 차단.
    ExternalWriteCtx ctx =
        txTemplate.execute(
            s -> {
              requireOwner(callerId, id);
              requireWritableEvent(id);
              CalendarEventResponse cur =
                  repo.findById(callerId, id)
                      .orElseThrow(() -> new CalendarEventNotFoundException(id));
              var ref =
                  repo.findExternalRef(id)
                      .orElseThrow(() -> new CalendarEventNotFoundException(id));
              if (ref.externalAccountId() == null || ref.eventExternalId() == null) {
                return new ExternalWriteCtx(false, null, null, cur.calendarId());
              }
              EmailAccountResponse acc =
                  emailAccountRepo.findByIdAndUser(callerId, ref.externalAccountId()).orElse(null);
              return acc == null
                  ? new ExternalWriteCtx(false, null, null, cur.calendarId())
                  : new ExternalWriteCtx(true, acc, ref.eventExternalId(), cur.calendarId());
            });

    if (ctx.external()) {
      // ② 외부 쓰기 → Graph HTTP (tx 밖). 가드: 호출자 ambient tx(AI·채팅 confirm) 안이면 REQUIRED txTemplate 이 그
      // tx 에
      // 합류해 아래 Graph HTTP 가 tx 안에서 실행된다("HTTP 는 어떤 tx 안에서도 금지" 위반). 정식 수정은 후속 #548 — 그때까지 차단.
      if (TransactionSynchronizationManager.isActualTransactionActive()) {
        throw new ExternalCalendarWriteInTransactionException();
      }
      // 외부 일정은 단일 — 반복 전환 차단(#546).
      if (req.recurrenceRule() != null && !req.recurrenceRule().isBlank()) {
        throw new RecurringNotSupportedOnExternalCalendarException();
      }
      // 동기화 일정의 다른 캘린더 이동 차단(#502 범위 밖 — Graph move 별도 API). 조용히 무시하지 않고 422 로 명시.
      if (req.calendarId() != null && !req.calendarId().equals(ctx.currentCalendarId())) {
        throw new ExternalEventMoveNotSupportedException();
      }
      transportFor(ctx.account().provider())
          .updateEvent(callerId, ctx.account(), ctx.externalId(), toGraphWrite(req));
      // ③ 로컬 반영 — 필드만 갱신(캘린더 이동 없음). 동기화 컨테이너 유지. 최종 get() 도 tx 안.
      return txTemplate.execute(
          s -> {
            repo.update(id, req);
            applyReminder(id, req.reminderMinutes());
            return get(callerId, id);
          });
    }

    return txTemplate.execute(s -> doUpdateLocal(callerId, id, req, scope, occurrenceDate));
  }

  /**
   * update 의 로컬 경로 — 기존 update 본문(반복 scope 분기 포함). txTemplate 안에서만 호출.
   *
   * <p>requireOwner/requireWritableEvent 는 resolve 단계에서 이미 통과했으므로 재검증하지 않는다(이중 검증 불필요). target 재조회만
   * 유지.
   */
  private CalendarEventResponse doUpdateLocal(
      long callerId,
      long id,
      CalendarEventRequest req,
      EditScope scope,
      OffsetDateTime occurrenceDate) {
    CalendarEventResponse target =
        repo.findById(callerId, id).orElseThrow(() -> new CalendarEventNotFoundException(id));

    // 단일 일정 또는 ALL → 마스터 행 전체 교체(RRULE 포함). 기존 예외는 유지(v1b 한계).
    if (target.recurrenceRule() == null || scope == EditScope.ALL) {
      if (req.calendarId() != null) {
        long resolved = resolveCalendarId(callerId, req.calendarId());
        repo.moveSingleEventToCalendar(id, resolved);
      }
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

  /** 외부 쓰기 컨텍스트 — update resolve 산출물. currentCalendarId 는 이동 차단 비교용. */
  private record ExternalWriteCtx(
      boolean external, EmailAccountResponse account, String externalId, Long currentCalendarId) {}

  /**
   * THIS 수정 — 회차를 대체할 독립 일정(RRULE=null, owner=마스터 owner)을 만들고 예외 행에 오버라이드로 연결한다. 이미 오버라이드가 있으면 중복
   * 생성 대신 그 일정을 갱신한다(고아 방지). 리마인더는 create 와 동일 경로로 부여. 신규 생성된 오버라이드에는 마스터의 참석자를 복사한다.
   */
  private CalendarEventResponse updateThisOccurrence(
      long callerId, long masterId, CalendarEventRequest req, OffsetDateTime occurrenceDate) {
    CalendarEventRequest overrideReq = withoutRecurrence(req);
    // 마스터의 calendarId 상속: req 에 지정 없으면 마스터 것, 지정 있으면 resolve 검증 후 사용.
    CalendarEventResponse master =
        repo.findById(callerId, masterId)
            .orElseThrow(() -> new CalendarEventNotFoundException(masterId));
    long calId =
        resolveCalendarId(
            callerId, req.calendarId() != null ? req.calendarId() : master.calendarId());
    // 신규 생성 여부 추적 — 기존 오버라이드 갱신 시에는 참석자를 재복사하지 않는다(이미 보유).
    boolean[] isNew = {false};
    long overrideId =
        exceptionRepo
            .findOverrideEventId(masterId, occurrenceDate)
            .map(
                existing -> {
                  repo.moveSingleEventToCalendar(existing, calId);
                  repo.update(existing, overrideReq);
                  return existing;
                })
            .orElseGet(
                () -> {
                  isNew[0] = true;
                  return repo.insert(callerId, calId, overrideReq);
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
    // 새 마스터: req.calendarId 지정 시 검증, 없으면 기존 마스터의 캘린더 상속.
    long calId =
        resolveCalendarId(
            callerId, req.calendarId() != null ? req.calendarId() : master.calendarId());
    long newMasterId = repo.insert(callerId, calId, req);
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
   * 일정 삭제 — 외부 동기화 일정이면 Graph DELETE(404=이미 없음 성공) 후 로컬 삭제, 그 외 기존 로컬 로직(반복 scope 포함).
   *
   * <p>비-@Transactional 오케스트레이터: resolve(tx) → Graph HTTP(tx 밖) → persist(tx). create/update 와 동일한
   * 3단계로 HTTP 를 어떤 tx 안에서도 호출하지 않는다(#232 커넥션 점유, #492 GUC 부재 회피). delete 는 페이로드(날짜·타임존)를 보내지 않으므로
   * 종일/타임존 관심사가 없다. Graph DELETE 가 502(non-404)로 실패하면 persist 진입 전에 던져져 로컬 행이 남는다. 404 는 transport
   * 가 정상 반환하므로(이미 없음=삭제 목표 상태) 502 로 둔갑하지 않고 로컬 삭제를 진행한다.
   */
  public void delete(long callerId, long id, EditScope scope, OffsetDateTime occurrenceDate) {
    // ① resolve — owner(404)·RO(409) 검증 + 외부 참조(externalId/account) 로드. delete 는 이동이 없어
    // currentCalendarId 불필요(null).
    ExternalWriteCtx ctx =
        txTemplate.execute(
            s -> {
              requireOwner(callerId, id);
              requireWritableEvent(id);
              var ref =
                  repo.findExternalRef(id)
                      .orElseThrow(() -> new CalendarEventNotFoundException(id));
              if (ref.externalAccountId() == null || ref.eventExternalId() == null) {
                return new ExternalWriteCtx(false, null, null, null);
              }
              EmailAccountResponse acc =
                  emailAccountRepo.findByIdAndUser(callerId, ref.externalAccountId()).orElse(null);
              return acc == null
                  ? new ExternalWriteCtx(false, null, null, null)
                  : new ExternalWriteCtx(true, acc, ref.eventExternalId(), null);
            });

    if (ctx.external()) {
      // ② 외부 삭제 → Graph HTTP(tx 밖). 가드: 호출자 ambient tx(AI·채팅 confirm) 안이면 REQUIRED txTemplate 이 그
      // tx 에
      // 합류해 아래 Graph HTTP 가 tx 안에서 실행된다("HTTP 는 어떤 tx 안에서도 금지" 위반). 정식 수정은 후속 #548 — 그때까지 차단.
      if (TransactionSynchronizationManager.isActualTransactionActive()) {
        throw new ExternalCalendarWriteInTransactionException();
      }
      // 404(이미 없음)는 transport 가 예외 없이 반환 → 로컬 삭제 진행. 502(non-404)는 여기서 던져져 로컬 삭제를 막는다.
      transportFor(ctx.account().provider()).deleteEvent(callerId, ctx.account(), ctx.externalId());
      // ③ 로컬 삭제 — 외부 일정은 단일이라 scope 무관(마스터 행 제거). 동기화 prune 은 external_id 부재로 영향 없음.
      txTemplate.execute(
          s -> {
            repo.delete(id);
            return null;
          });
      return;
    }

    txTemplate.execute(
        s -> {
          doDeleteLocal(callerId, id, scope, occurrenceDate);
          return null;
        });
  }

  /**
   * delete 의 로컬 경로 — 기존 delete 본문(반복 scope 분기 포함). txTemplate 안에서만 호출.
   *
   * <p>requireOwner/requireWritableEvent 는 resolve 단계에서 이미 통과했으므로 재검증하지 않는다(이중 검증 불필요). 단일 일정이거나
   * scope=ALL 이면 마스터 삭제(예외·리마인더 cascade). 오버라이드 별도 일정은 cascade 되지 않으므로 직접 제거. THIS=회차 취소,
   * THIS_AND_FOLLOWING=시리즈 잘라내기.
   */
  private void doDeleteLocal(
      long callerId, long id, EditScope scope, OffsetDateTime occurrenceDate) {
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
    requireWritableEvent(eventId);
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
    requireWritableEvent(eventId);
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
    // 참석자 아님(존재 불명) → 이벤트 존재 자체를 은닉(404). 읽기전용 이벤트는 참석자 행이 없으므로 여기서 먼저 404 로 차단됨.
    if (updated == 0) throw new CalendarEventNotFoundException(eventId);
    // 참석자 행 존재 확정 후 읽기전용 검사 — 비참석자에게 읽기전용 여부(409)를 노출하지 않도록 순서 보장.
    requireWritableEvent(eventId);
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
        e.calendarId(),
        e.calendarName(),
        e.effectiveColor(),
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

  /** override 색 검증 — null 은 상속(허용), 값이 있으면 팔레트 키만 허용. */
  private void validateColorOverride(String color) {
    if (color != null && !com.workplace.calendar.CalendarPalette.isValid(color)) {
      throw new IllegalArgumentException("허용되지 않은 색입니다: " + color);
    }
  }

  /**
   * calendarId resolve — null 이면 기본 캘린더, 지정이면 소유 + 쓰기가능 검증 후 그대로.
   *
   * <p>일정 생성/이동 공통 chokepoint. 읽기전용 외부 컨테이너는 owner_id = 동기화 유저이므로 소유 검증만으론 막히지 않는다.
   * requireWritableCalendar 가 추가로 is_read_only 를 확인하여 ReadOnlyCalendarException(409) 을 던진다.
   */
  private long resolveCalendarId(long callerId, Long calendarId) {
    if (calendarId == null) {
      return calendarService.ensureDefault(callerId);
    }
    calendarService.requireWritableCalendar(callerId, calendarId);
    return calendarId;
  }

  /** 반복 일정의 THIS/THIS_AND_FOLLOWING 는 회차 식별자(occurrenceDate)가 필수 — 누락 시 400. */
  private static void requireOccurrenceDate(EditScope scope, OffsetDateTime occurrenceDate) {
    if (occurrenceDate == null) {
      throw new IllegalArgumentException("occurrenceDate required for THIS/THIS_AND_FOLLOWING");
    }
  }

  /** 오버라이드 일정은 단일 일정이어야 하므로 RRULE 을 제거한 요청 복제. calendarId 는 보존. */
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
        null, // 오버라이드 일정은 단일이므로 참석자 인수 제거
        req.calendarId()); // calendarId 보존 — resolve 는 호출측에서 수행
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

  /** 읽기전용(외부 동기화) 컨테이너 소속 이벤트는 로컬 변경 불가 — 동기화만 관리. requireOwner 통과 후 호출. */
  private void requireWritableEvent(long eventId) {
    if (repo.isEventCalendarReadOnly(eventId)) {
      throw new ReadOnlyCalendarException(eventId);
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
