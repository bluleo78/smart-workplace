package com.workplace.calendar.service;

import com.workplace.calendar.CalendarPalette;
import com.workplace.calendar.repository.CalendarTagRepository;
import com.workplace.calendar.repository.EventAttendeeRepository;
import com.workplace.calendar.repository.ExternalCalendarRepository;
import com.workplace.calendar.repository.ExternalCalendarRepository.ExternalEventRow;
import com.workplace.global.util.Texts;
import com.workplace.mail.dto.EmailAccountResponse;
import com.workplace.mail.dto.MailProvider;
import com.workplace.mail.outbound.GraphCalendarClient;
import com.workplace.mail.outbound.GraphCalendarClient.GraphCalendar;
import com.workplace.mail.outbound.GraphCalendarClient.GraphEvent;
import com.workplace.mail.outbound.GraphCalendarClient.GraphEventAttendee;
import com.workplace.mail.service.GraphTokenService;
import com.workplace.user.repository.UserRepository;
import java.sql.SQLException;
import java.time.LocalDateTime;
import java.time.OffsetDateTime;
import java.time.Period;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionStatus;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * Microsoft Graph API 공급자용 {@link CalendarFetcher} 구현.
 *
 * <p>collect-then-persist 패턴 준수: HTTP 호출(getAccessToken / listCalendars / listCalendarView)은 트랜잭션
 * 밖에서 수행하고, DB 쓰기(upsert / prune / reconcile)는 {@link TransactionTemplate} 으로 짧은 트랜잭션 안에서 실행한다. 이를
 * 통해 HTTP I/O 중 커넥션 점유를 방지한다(#232 패턴).
 */
@Slf4j
@Component
public class GraphCalendarFetcher implements CalendarFetcher {

  /** 동기화 구간: 과거 1개월 ~ 미래 3개월 (슬라이딩 윈도우). */
  private static final Period WINDOW_BACK = Period.ofMonths(1);

  private static final Period WINDOW_FWD = Period.ofMonths(3);

  /**
   * Graph calendarColor 열거 → 팔레트 키 매핑 테이블.
   *
   * <p>CalendarPalette.isValid() 검증 후 사용. Graph 의 9개 색 열거값은 팔레트 8종보다 많아 1:1 매핑이 불가능하고(#825),
   * lightYellow 는 팔레트에 대응 색이 없어 amber 와 공유한다 — 매핑이 없거나(dead key) 같은 계정 내 이미 사용 중인 색과 충돌하면 {@link
   * #resolveColor} 가 미사용 팔레트 키로 대체 배정한다.
   */
  private static final Map<String, String> COLOR_MAP =
      Map.of(
          "lightBlue", "blue",
          "lightGreen", "green",
          "lightOrange", "amber",
          "lightRed", "red",
          "lightYellow", "amber",
          "lightTeal", "teal",
          "lightPink", "pink",
          "lightBrown", "violet",
          "lightGray", "gray");

  /** 라운드로빈 폴백 배정 순서 — {@link CalendarPalette#KEYS} 와 동일 집합, 순서만 고정. */
  private static final List<String> PALETTE_ORDER =
      List.of("blue", "green", "red", "amber", "violet", "pink", "teal", "gray");

  /** 참석자 diff 행 스펙(내부 userId 또는 외부 email). */
  private record Spec(
      Long userId, String externalEmail, String externalName, String role, String rsvp) {}

  private final GraphTokenService tokenService;
  private final GraphCalendarClient graphClient;
  private final ExternalCalendarRepository extRepo;
  private final EventAttendeeRepository attendeeRepo;
  private final UserRepository userRepo;
  // Outlook 범주 → 캘린더 주인의 태그 연결(WP-714).
  private final CalendarTagRepository tagRepo;

  /**
   * 짧은-트랜잭션용 TransactionTemplate — @Primary TenantAwareTransactionManager 로 구성해 트랜잭션 진입 시 RLS
   * GUC(app.tenant_id) 가 주입된다(#444/#492 패턴).
   */
  private final TransactionTemplate txTemplate;

  public GraphCalendarFetcher(
      GraphTokenService tokenService,
      GraphCalendarClient graphClient,
      ExternalCalendarRepository extRepo,
      EventAttendeeRepository attendeeRepo,
      UserRepository userRepo,
      CalendarTagRepository tagRepo,
      PlatformTransactionManager txManager) {
    this.tokenService = tokenService;
    this.graphClient = graphClient;
    this.extRepo = extRepo;
    this.attendeeRepo = attendeeRepo;
    this.userRepo = userRepo;
    this.tagRepo = tagRepo;
    this.txTemplate = new TransactionTemplate(txManager);
  }

  @Override
  public MailProvider provider() {
    return MailProvider.M365_GRAPH;
  }

  /**
   * Graph 캘린더 동기화 — collect-then-persist.
   *
   * <p>1단계(HTTP, tx 밖): 토큰 획득 → 달력 목록 → 달력별 구간 일정 조회 → 메모리 수집. 2단계(DB, tx 안): 달력별 upsert/prune →
   * 사라진 컨테이너 reconcile(deleteExternalCalendar).
   *
   * <p>DB 단계에서 실제로 새로 생기거나 바뀌거나 지워진 일정의 내부 참석자(소유자 제외)를 모은다(WP-1733) — 같은 회의를 자기 화면에서 보는 다른 사용자에게도
   * 갱신 알림을 보내려고. 바뀐 일정은 변경 전·후 명단을 모두 넣어 참석자에서 빠진 사람도 화면이 갱신되게 하고, 지워질 일정·달력은 참석자 행이 cascade 로
   * 사라지므로 삭제 전에 읽는다. 바뀐 것이 없으면 빈 집합이다. 달력 저장이 실패해 롤백된 시도의 명단은 버리고 커밋된 시도의 명단만 합친다(WP-1710).
   *
   * @return upsert 된 총 이벤트 수 + 알릴 내부 참석자
   */
  @Override
  public SyncResult sync(long userId, long accountId, EmailAccountResponse account) {
    // 수집 시작 시각 — Graph 를 읽기 전에 잡는다. 이보다 늦게 앱이 범주를 써 넣은 일정은 이번에 읽은 범주가 낡았으므로 연결을 건너뛴다(WP-716).
    // 써 넣기 표시(CalendarTagService)와 같은 앱 서버 시계를 쓴다.
    OffsetDateTime now = OffsetDateTime.now(ZoneOffset.UTC);
    OffsetDateTime from = now.minus(WINDOW_BACK);
    OffsetDateTime to = now.plus(WINDOW_FWD);

    // ── 1단계: HTTP 수집 — 트랜잭션 밖 ────────────────────────────────────────────
    String token = tokenService.getAccessToken(userId, accountId);
    List<GraphCalendar> calendars = graphClient.listCalendars(token);

    record CalendarBatch(GraphCalendar calendar, List<GraphEvent> events) {}
    List<CalendarBatch> batches = new ArrayList<>();
    for (GraphCalendar cal : calendars) {
      List<GraphEvent> events = graphClient.listCalendarView(token, cal.id(), from, to);
      batches.add(new CalendarBatch(cal, events));
    }

    // ── 2단계: DB persist — 달력별 짧은 트랜잭션 ──────────────────────────────────
    String mailboxOwner = mailboxOwnerAddress(calendars);
    SyncScope scope = new SyncScope(userId, accountId, account.emailAddress(), now, from, to);
    int totalUpserted = 0;
    Set<Long> seenCalendarIds = new HashSet<>();
    // 계정 안의 캘린더끼리 색이 겹치지 않도록 이번 sync 호출 동안 배정된 색을 추적한다 (#825).
    Set<String> usedColorsForAccount = new HashSet<>();
    // 이번 회차에 저장하지 못한 달력의 Graph id — reconcile 에서 기존 로컬 달력을 지우지 않게 seen 으로 넣는다(WP-1710).
    List<String> failedExternalIds = new ArrayList<>();
    RuntimeException lastCalendarFailure = null;
    // 실제로 바뀐(생성·변경·삭제) 일정의 내부 참석자 — 커밋된 달력 저장의 명단만 합치고, 끝에서 소유자를 뺀다(WP-1733·WP-1710).
    Set<Long> affectedAttendees = new HashSet<>();

    for (CalendarBatch batch : batches) {
      GraphCalendar cal = batch.calendar();
      String color = resolveColor(cal.color(), usedColorsForAccount);
      usedColorsForAccount.add(color);

      PersistResult result;
      try {
        result = persistCalendarWithFallback(scope, cal, batch.events(), color, mailboxOwner);
      } catch (RuntimeException e) {
        // 격리해도 달력 단위로 실패(트랜잭션 롤백) — 이 달력만 건너뛰고 다음 달력으로(WP-1710).
        // 참석자 명단은 시도마다 따로 모아 성공한 결과로만 돌려받으므로, 롤백된 시도의 명단은 여기서 합쳐지지 않는다(WP-1733).
        logCalendarFailure(scope, cal.id(), e, true);
        failedExternalIds.add(cal.id());
        lastCalendarFailure = e;
        continue;
      }

      seenCalendarIds.add(result.calendarId());
      totalUpserted += result.upserted();
      // 커밋된 시도의 명단만 합친다(WP-1710·WP-1733).
      affectedAttendees.addAll(result.affectedAttendees());
    }

    // 모든 달력이 실패했으면 성공으로 보이지 않게 던진다(WP-1710) — CalendarSyncService 가 calendarChanged 를 내지 않고
    // 디스패처가 실패로 기록한다. 일부만 실패했으면 로그만 남기고 계속한다.
    if (!calendars.isEmpty() && failedExternalIds.size() == calendars.size()) {
      throw new IllegalStateException(
          "Graph 달력 동기화가 모든 달력에서 실패: accountId=" + accountId, lastCalendarFailure);
    }

    // 컨테이너 reconcile: 공급자에서 사라진 달력(기존 컨테이너에서 이번 동기화에서 미수신) 삭제.
    // 빈 목록 가드: Graph API 가 일시적으로 빈 응답(value:[])을 반환하면 모든 컨테이너를 삭제하게 되므로,
    // 실제로 1개 이상의 달력을 수신한 경우에만 reconcile-delete 를 실행한다.
    if (!calendars.isEmpty()) {
      txTemplate.execute(
          status -> {
            // 실패한 달력은 Graph 에는 있으므로 기존 로컬 달력을 seen 으로 친다(WP-1710) — 안 그러면 일정과 함께 지워진다.
            // 정리 자체는 그대로 돌려, 계속 실패하는 달력이 Outlook 에서 정말 지운 달력의 정리를 막지 않게 한다.
            for (String externalId : failedExternalIds) {
              extRepo.findExternalCalendarId(accountId, externalId).ifPresent(seenCalendarIds::add);
            }
            List<Long> existing = extRepo.listExternalCalendarIds(accountId);
            for (long existingId : existing) {
              if (!seenCalendarIds.contains(existingId)) {
                // 달력이 지워지면 소속 일정·참석자 행이 cascade 로 사라지므로 내부 참석자를 먼저 모은다(WP-1733).
                affectedAttendees.addAll(attendeeRepo.findInternalUserIdsByCalendar(existingId));
                extRepo.deleteExternalCalendar(existingId);
              }
            }
            return null;
          });
    }

    log.debug(
        "Graph 캘린더 동기화 완료: userId={} accountId={} calendars={} events={}",
        userId,
        accountId,
        calendars.size(),
        totalUpserted);
    // 소유자는 동기화 완료 알림을 따로 늘 받으므로 참석자 명단에서 뺀다(동기화 계정 주소가 소유자로 매칭돼 참석자 행에 들어 있다).
    affectedAttendees.remove(userId);
    return new SyncResult(totalUpserted, affectedAttendees);
  }

  /**
   * 빠른 길: 세이브포인트 없이 한 트랜잭션으로 저장한다(WP-1710). 일정마다 세이브포인트를 두면 64개를 넘는 순간 PostgreSQL 서브트랜잭션 캐시가 넘쳐
   * SubtransSLRU 경합이 생기므로, 실패한 달력만 일정별 격리로 한 번 더 시도한다. 격리 재시도도 실패하면 그 예외를 던진다.
   */
  private PersistResult persistCalendarWithFallback(
      SyncScope scope,
      GraphCalendar cal,
      List<GraphEvent> events,
      String color,
      String mailboxOwner) {
    try {
      return persistCalendar(scope, cal, events, color, mailboxOwner, false);
    } catch (RuntimeException fastFailure) {
      logCalendarFailure(scope, cal.id(), fastFailure, false);
      return persistCalendar(scope, cal, events, color, mailboxOwner, true);
    }
  }

  /**
   * 달력 저장 실패를 로그로 남긴다 — finalFailure=false 는 빠른 길 실패(info, 격리 재시도 예정), true 는 격리 재시도까지 실패(warn,
   * 건너뜀). 메시지에는 PostgreSQL 의 "Failing row contains (...)" 로 행 데이터가 실릴 수 있어 info/warn 에는
   * 식별자·클래스명·SQLState 만 남기고 전체 예외는 debug 로만 남긴다.
   */
  private void logCalendarFailure(
      SyncScope scope, String calendarId, RuntimeException e, boolean finalFailure) {
    String error = e.getClass().getSimpleName();
    String sqlState = sqlStateOf(e);
    if (finalFailure) {
      log.warn(
          "Graph 달력 동기화 실패, 건너뜀: userId={} accountId={} calendarId={} error={} sqlState={}",
          scope.userId(),
          scope.accountId(),
          calendarId,
          error,
          sqlState);
      log.debug("Graph 달력 동기화 실패 상세: calendarId={}", calendarId, e);
    } else {
      log.info(
          "Graph 달력 빠른 저장 실패, 일정별 격리로 다시 시도: userId={} accountId={} calendarId={} error={} sqlState={}",
          scope.userId(),
          scope.accountId(),
          calendarId,
          error,
          sqlState);
      log.debug("Graph 달력 빠른 저장 실패 상세: calendarId={}", calendarId, e);
    }
  }

  /** 한 번의 sync 호출 동안 바뀌지 않는 값 — 달력 저장 메서드에 넘긴다(WP-1710). */
  record SyncScope(
      long userId,
      long accountId,
      String accountEmail,
      OffsetDateTime now,
      OffsetDateTime from,
      OffsetDateTime to) {}

  /**
   * 달력 하나를 저장한 결과 — 로컬 calendar.id, 저장한 일정 수, 이 시도에서 실제로 바뀌거나 지워진 일정의 내부 참석자(WP-1733). 참석자 명단은
   * 시도(트랜잭션)마다 새로 모으므로, 롤백된 시도의 명단은 결과로 나가지 않는다(WP-1710).
   */
  record PersistResult(long calendarId, int upserted, Set<Long> affectedAttendees) {}

  /** 일정 하나를 저장한 결과 — 로컬 calendar_event.id 와 일정 필드·참석자가 실제로 바뀌었는지(WP-1733). */
  record EventPersist(long eventId, boolean changed) {}

  /**
   * 달력 하나(컨테이너·일정·참석자·범주 태그·prune)를 한 트랜잭션으로 저장한다.
   *
   * <p>isolateEvents=false 는 빠른 길로, 어떤 오류든 트랜잭션 전체가 롤백되고 예외가 그대로 나간다. true 는 실패한 달력의 재시도로, 일정마다
   * 세이브포인트를 두어 실패한 일정만 되돌리고 나머지를 저장한다(WP-1710). 테스트가 어느 길을 탔는지 확인할 수 있게 package-private 이다.
   */
  PersistResult persistCalendar(
      SyncScope scope,
      GraphCalendar cal,
      List<GraphEvent> events,
      String color,
      String mailboxOwner,
      boolean isolateEvents) {
    // 내 사서함 달력인가(WP-716) — 편집 권한으로 공유받은 동료 달력(canEdit=true)은 아니다. 범주 ↔ 태그는 내 사서함의 쓸 수 있는 달력만
    // 잇는다: 남의 사서함 범주로 태그를 만들면 지울 수도, 써 넣을 수도 없다.
    boolean ownMailbox = isOwnMailbox(cal, mailboxOwner);
    boolean categoryTags = cal.canEdit() && ownMailbox;

    return txTemplate.execute(
        status -> {
          // canEdit=false(공휴일·생일 등) → is_read_only=true, canEdit=true → is_read_only=false
          long calId =
              extRepo.upsertExternalCalendar(
                  scope.userId(),
                  scope.accountId(),
                  cal.id(),
                  cal.name(),
                  color,
                  !cal.canEdit(),
                  ownMailbox);

          // 변경 전 명단 — 일정별 내부 참석자. 바뀐 일정의 이전 참석자·지워질 일정의 참석자를 여기서 꺼낸다(삭제되면 cascade 로 사라짐)(WP-1733).
          Map<Long, Set<Long>> attendeesBefore =
              attendeeRepo.findInternalUserIdsByEventInCalendar(calId, scope.from(), scope.to());
          // 이 시도(트랜잭션)만의 버퍼 — 시도가 롤백되면 결과로 나가지 않아 함께 버려진다(WP-1710·WP-1733).
          Set<Long> affected = new HashSet<>();
          Set<Long> changedEventIds = new HashSet<>();
          int count = 0;
          Set<String> keep = new HashSet<>();
          // 로컬 일정 id → Outlook 범주 이름(응답에 categories 가 있던 일정만) — 달력 단위로 모아 태그를 한 번에 맞춘다(WP-714).
          Map<Long, List<String>> categoriesByEvent = new HashMap<>();
          for (GraphEvent evt : events) {
            if (evt.isCancelled()) {
              // 취소된 이벤트는 upsert 생략 — keep 에도 미추가하여 prune 대상으로 처리
              continue;
            }
            // 빠른 길은 실패하면 예외를 그대로 던지고, 격리 모드는 실패한 일정만 되돌린 뒤 null 을 돌려준다.
            EventPersist persisted;
            if (isolateEvents) {
              persisted = persistEventIsolated(status, scope, calId, cal, evt);
            } else {
              persisted = persistEvent(scope, calId, cal, evt);
            }
            if (persisted == null) {
              // 세지는 않지만 keep 에는 넣는다 — 빼면 pruneEventsNotIn 이 기존 행을 지우고 cascade 로 사용자가 앱에서 만든
              // 알림·회의록 연결·앱 태그까지 사라진다. 낡은 값이 남더라도 다음 회차가 다시 시도한다.
              // 세이브포인트로 되돌린 일정은 바뀐 것이 없으므로 참석자도 모으지 않는다(WP-1710·WP-1733).
              keep.add(evt.id());
              continue;
            }
            long localEventId = persisted.eventId();
            // 실제로 바뀐 일정만 변경 전 명단을 모으고, 변경 후 명단은 루프 뒤 한 번에 읽는다(WP-1733).
            if (persisted.changed()) {
              changedEventIds.add(localEventId);
              affected.addAll(attendeesBefore.getOrDefault(localEventId, Set.of()));
            }
            // 범주 → 태그는 내 사서함의 쓸 수 있는 달력만(WP-714 리뷰·WP-716 리뷰) — 동료가 공유한 달력(읽기 전용이든 편집 권한이든)·
            // 공휴일·생일 달력의 범주는 남의 사서함 것이라, 내 태그로 만들면 지울 수도 Outlook 에 써 넣을 수도 없는 태그가 쌓인다.
            if (categoryTags && evt.categories() != null) {
              categoriesByEvent.put(localEventId, evt.categories());
            }
            keep.add(evt.id());
            count++;
          }
          // 이번 수집 뒤에 앱이 범주를 써 넣은 일정은 건너뛴다(WP-716) — 써 넣기 전에 읽은 범주로 새 연결을 되돌리지 않게. 다음 동기화가 맞춘다.
          categoriesByEvent
              .keySet()
              .removeAll(
                  extRepo.eventIdsWithCategoriesWrittenAfter(
                      categoriesByEvent.keySet(), scope.now()));
          syncCategoryTags(scope.userId(), categoriesByEvent);
          // 바뀐 일정의 변경 후 명단 — 새로 초대된 사람도 갱신되게(WP-1733).
          affected.addAll(attendeeRepo.findInternalUserIdsByEvents(changedEventIds));
          // 지워진 일정의 참석자 — 삭제 전에 읽어 둔 명단에서 꺼낸다(WP-1733).
          for (long deletedId :
              extRepo.pruneEventsNotIn(calId, keep, scope.from(), scope.to(), scope.now())) {
            affected.addAll(attendeesBefore.getOrDefault(deletedId, Set.of()));
          }
          return new PersistResult(calId, count, affected);
        });
  }

  /**
   * 일정 하나를 세이브포인트로 감싸 저장한다 — PostgreSQL 은 오류가 나면 트랜잭션 전체가 중단되므로, 그 일정만 되돌려야 뒤따르는 쿼리가 산다(WP-1710).
   * 실패하면 그 일정만 롤백하고 null 을 돌려준다. 메시지에는 "Failing row contains (...)" 로 일정 제목·본문이 실릴 수 있어 클래스명과
   * SQLState 만 남긴다.
   *
   * @return 로컬 calendar_event.id 와 변경 여부, 저장에 실패해 되돌렸으면 null
   */
  private EventPersist persistEventIsolated(
      TransactionStatus status, SyncScope scope, long calId, GraphCalendar cal, GraphEvent evt) {
    Object savepoint = status.createSavepoint();
    try {
      EventPersist persisted = persistEvent(scope, calId, cal, evt);
      status.releaseSavepoint(savepoint);
      return persisted;
    } catch (RuntimeException e) {
      status.rollbackToSavepoint(savepoint);
      log.warn(
          "Graph 일정 저장 실패, 건너뜀: userId={} accountId={} eventId={} error={} sqlState={}",
          scope.userId(),
          scope.accountId(),
          evt.id(),
          e.getClass().getSimpleName(),
          sqlStateOf(e));
      log.debug("Graph 일정 저장 실패 상세: eventId={}", evt.id(), e);
      return null;
    }
  }

  /**
   * 일정 하나 upsert + (쓸 수 있는 달력이면) 참석자 동기화. 로컬 calendar_event.id 와, 일정 필드나 참석자·RSVP 가 실제로 바뀌었는지를
   * 돌려준다(WP-1733 — 바뀐 일정의 내부 참석자에게만 알리려고).
   */
  private EventPersist persistEvent(
      SyncScope scope, long calId, GraphCalendar cal, GraphEvent evt) {
    ExternalEventRow row = mapEvent(evt);
    var upsert = extRepo.upsertExternalEvent(scope.userId(), calId, evt.id(), row);
    boolean changed = upsert.changed();
    // writable 캘린더의 일정만 참석자 동기화(공휴일·생일 등 read-only 는 skip). 참석자·RSVP 가 바뀐 것도 변경으로 본다.
    if (cal.canEdit()) {
      changed |= syncAttendees(upsert.id(), evt, scope.userId(), scope.accountEmail());
    }
    return new EventPersist(upsert.id(), changed);
  }

  /**
   * Graph dateTimeTimeZone → UTC OffsetDateTime.
   *
   * <p>calendarView 응답은 Prefer 헤더 미설정 시 UTC 로 반환되나 dateTime 문자열에 오프셋('Z')이 없는 경우가 있다(예:
   * "2026-07-10T00:00:00.0000000"). 우선 OffsetDateTime.parse, 실패하면 LocalDateTime.parse + UTC 가정.
   */
  private static OffsetDateTime parseDateTime(String dateTime) {
    try {
      return OffsetDateTime.parse(dateTime);
    } catch (Exception e) {
      return LocalDateTime.parse(dateTime).atOffset(ZoneOffset.UTC);
    }
  }

  /**
   * 설명 최대 길이 — {@code CalendarEventRequest.description} 의 {@code @Size(max = 10000)} 과 같다(앱에서 쓰는
   * 일정과 같은 한도).
   */
  static final int DESCRIPTION_MAX = 10_000;

  /**
   * 일정 설명 = 본문 전체(WP-709). 예전엔 255자짜리 bodyPreview 만 저장해 긴 초대 본문이 잘렸다.
   *
   * <p>동기화는 {@code Prefer: outlook.body-content-type="text"} 로 본문을 받으므로 body.content 는 텍스트다. 그래도
   * Graph 가 HTML 로 돌려주면(헤더 무시) 태그가 그대로 화면에 나오므로 그 경우엔 미리보기로 대신한다. 본문이 비면 미리보기, 둘 다 비면 null. 줄바꿈은
   * {@code \n} 으로 맞추고 앞뒤 공백을 자르며, {@link #DESCRIPTION_MAX} 를 넘으면 앞 (최대-1)자 + 「…」 로 줄인다.
   */
  static String mapDescription(GraphEvent evt) {
    var body = evt.body();
    // 본문이 HTML 로 오면 태그가 그대로 보이므로 건너뛰고 미리보기로 대신한다.
    String fromBody =
        body == null || "html".equalsIgnoreCase(body.contentType())
            ? ""
            : normalizeText(body.content());
    String text = fromBody.isEmpty() ? normalizeText(evt.bodyPreview()) : fromBody;
    if (text.isEmpty()) return null;
    // 서로게이트 쌍(이모지 등) 한가운데를 자르면 홀로 남은 반쪽이 UTF-8 로 저장되지 않아 동기화 트랜잭션이 깨진다 — headUtf16 이 쌍 앞에서 자른다.
    return text.length() <= DESCRIPTION_MAX
        ? text
        : Texts.headUtf16(text, DESCRIPTION_MAX - 1) + "…";
  }

  /** 참가 주소 최대 길이 — {@code calendar_event.online_meeting_url VARCHAR(2000)} 과 같다. */
  static final int JOIN_URL_MAX = 2000;

  /**
   * Graph onlineMeeting.joinUrl → 저장할 참가 주소(WP-710). http(s) 로 파싱되지 않거나 비었거나 컬럼 길이를 넘으면 null — 저장은
   * 못 해도 설명·장소에서 찾는 응답 쪽 판정이 이어서 동작한다.
   */
  static String mapJoinUrl(GraphEvent evt) {
    if (evt.onlineMeeting() == null || evt.onlineMeeting().joinUrl() == null) return null;
    String url = evt.onlineMeeting().joinUrl().trim();
    // 응답 쪽 판정과 같은 검사(OnlineMeetingResolver.isHttpUrl) — 저장했는데 판정에서 무시되는 주소를 만들지 않는다.
    return OnlineMeetingResolver.isHttpUrl(url) && url.length() <= JOIN_URL_MAX ? url : null;
  }

  /**
   * 이 계정 사서함의 주인 주소 — 기본 달력의 owner 주소(WP-716). 메일 계정에 저장한 주소와 비교하지 않는 것은 로그인 이름(UPN)과 기본 SMTP 주소가
   * 다른 계정에서 내 달력이 모두 남의 것으로 보이기 때문이다. 기본 달력이 없거나 owner 가 없으면 null.
   */
  static String mailboxOwnerAddress(List<GraphCalendar> calendars) {
    return calendars.stream()
        .filter(GraphCalendar::isDefaultCalendar)
        .map(c -> c.owner() == null ? null : Texts.blankToNull(c.owner().address()))
        .filter(Objects::nonNull)
        .findFirst()
        .orElse(null);
  }

  /**
   * 내 사서함 달력인가(WP-716) — 기본 달력이거나 owner 주소가 기본 달력의 owner 와 같다(대소문자 무시). owner 를 모르면 아니다(안전한 쪽 — 태그
   * 써 넣기를 막을 뿐 일정 동기화는 그대로다).
   */
  static boolean isOwnMailbox(GraphCalendar cal, String mailboxOwner) {
    if (cal.isDefaultCalendar()) return true;
    if (cal.owner() == null) return false;
    return Texts.equalsStrippedIgnoreCase(cal.owner().address(), mailboxOwner);
  }

  /** CRLF·CR → LF 로 맞추고 NUL(Postgres 텍스트에 저장 불가)을 지운 뒤 앞뒤 공백을 자른다. null 은 빈 문자열. */
  private static String normalizeText(String raw) {
    if (raw == null) return "";
    return raw.replace("\r\n", "\n").replace('\r', '\n').replace("\u0000", "").trim();
  }

  /** 예외 원인 사슬에서 첫 SQLException 의 SQLState 를 찾는다(없으면 null) — 행 데이터가 섞인 메시지 대신 로그에 남긴다(WP-1710). */
  private static String sqlStateOf(Throwable e) {
    for (Throwable t = e; t != null; t = t.getCause()) {
      if (t instanceof SQLException sql) return sql.getSQLState();
    }
    return null;
  }

  /**
   * 끝이 시작보다 이르거나 같은 일정의 끝을 보정한다(WP-1710).
   *
   * <p>Outlook 은 0분(시작=끝) 일정을 허용하지만 DB {@code calendar_event_time_check(ends_at > starts_at)} 는 이를
   * 거부해 동기화가 통째로 실패한다. 그래서 시간 일정은 시작+1분, 종일 일정은 시작+1일(반개구간 규약)로 끝을 늘린다. 끝이 시작보다 늦으면 그대로 둔다.
   */
  static OffsetDateTime normalizedEnd(
      OffsetDateTime startsAt, OffsetDateTime endsAt, boolean allDay) {
    if (endsAt.isAfter(startsAt)) return endsAt;
    return allDay ? startsAt.plusDays(1) : startsAt.plusMinutes(1);
  }

  /**
   * GraphEvent → ExternalEventRow 매핑.
   *
   * <p>종일 이벤트: Graph end 는 배타적(다음 날 자정)이며 DB 도 동일 반개구간(half-open) 규약을 사용하므로 변환 없이 그대로 저장한다. {@code
   * calendar_event_time_check(ends_at > starts_at)} 제약상 포함 종료일로 보정하면 1일 이벤트 시 위반이 발생한다. 빈/null 제목은
   * "(제목 없음)"로 폴백. 설명은 {@link #mapDescription} (본문 전체, 빈 값은 null).
   */
  private static ExternalEventRow mapEvent(GraphEvent evt) {
    String title = (evt.subject() == null || evt.subject().isBlank()) ? "(제목 없음)" : evt.subject();
    String description = mapDescription(evt);
    String location = (evt.location() != null) ? evt.location().displayName() : null;

    OffsetDateTime startsAt = parseDateTime(evt.start().dateTime());
    OffsetDateTime endsAt =
        normalizedEnd(startsAt, parseDateTime(evt.end().dateTime()), evt.isAllDay());

    return new ExternalEventRow(
        title,
        description,
        startsAt,
        endsAt,
        evt.isAllDay(),
        location,
        evt.iCalUId(),
        mapJoinUrl(evt),
        Texts.blankToNull(evt.seriesMasterId()),
        Texts.blankToNull(evt.type()));
  }

  /**
   * 한 외부 일정의 참석자를 Graph organizer+attendees 와 일치하도록 diff-upsert 한다.
   *
   * <p>이메일 매칭: ① 동기화 계정 이메일이면 동기화 user, ② findByEmailIgnoreCase, ③ 외부 행. organizer 는
   * ORGANIZER/ACCEPTED, attendees 는 ATTENDEE + responseStatus 매핑. target 에 없는 기존 행은 삭제(organizer 는
   * target 에 항상 포함돼 보존).
   *
   * @return 참석자 행을 넣거나 지우거나 RSVP 를 바꿨으면 true(WP-1733 — 참석자 변화도 일정 변경으로 알린다)
   */
  private boolean syncAttendees(
      long eventId, GraphEvent evt, long syncUserId, String syncAccountEmail) {
    boolean hasAttendees = evt.attendees() != null && !evt.attendees().isEmpty();
    boolean hasOrganizer =
        evt.organizer() != null
            && evt.organizer().emailAddress() != null
            && evt.organizer().emailAddress().address() != null;
    if (!hasAttendees && !hasOrganizer) return false; // 참석자 정보 없음 — 건드리지 않음

    // 1) target 구성: identity(키) → 행 스펙.
    Map<String, Spec> target = new LinkedHashMap<>();

    if (hasOrganizer) {
      var em = evt.organizer().emailAddress();
      Spec s =
          resolveSpec(
              em.name(), em.address(), "ORGANIZER", "ACCEPTED", syncUserId, syncAccountEmail);
      target.put(identity(s.userId(), s.externalEmail()), s);
    }
    if (hasAttendees) {
      for (GraphEventAttendee a : evt.attendees()) {
        if (a.emailAddress() == null || a.emailAddress().address() == null) continue;
        String rsvp =
            GraphCalendarClient.rsvpFromGraphResponse(
                a.status() == null ? null : a.status().response());
        Spec s =
            resolveSpec(
                a.emailAddress().name(),
                a.emailAddress().address(),
                "ATTENDEE",
                rsvp,
                syncUserId,
                syncAccountEmail);
        // 조직자가 attendees 에도 들어오면(드묾) ORGANIZER 우선 — 이미 있으면 덮어쓰지 않음.
        target.putIfAbsent(identity(s.userId(), s.externalEmail()), s);
      }
    }

    // 2) 기존 행 로드 + identity 집합 + RSVP 맵(변경 여부 guard 용).
    var existing = attendeeRepo.findByEvent(eventId);
    Set<String> existingIds = new HashSet<>();
    java.util.Map<String, String> existingRsvp = new java.util.HashMap<>();
    for (var r : existing) {
      String key = identity(r.userId(), r.externalEmail());
      existingIds.add(key);
      existingRsvp.put(key, r.rsvpStatus());
    }

    boolean changed = false;
    // 3) 삭제: 기존에 있지만 target 에 없는 행.
    for (var r : existing) {
      // AGENT 는 Graph 에 전송하지 않는 로컬 전용 구성 — sync 가 지우면 안 됨.
      if ("AGENT".equals(r.kind())) continue;
      String id = identity(r.userId(), r.externalEmail());
      if (!target.containsKey(id)) {
        if (r.userId() != null) attendeeRepo.deleteByEventAndUser(eventId, r.userId());
        else attendeeRepo.deleteByEventAndExternalEmail(eventId, r.externalEmail());
        changed = true;
      }
    }

    // 4) 추가/갱신.
    for (var e : target.entrySet()) {
      Spec s = e.getValue();
      if (!existingIds.contains(e.getKey())) {
        if (s.userId() != null) attendeeRepo.insert(eventId, s.userId(), null, s.role(), s.rsvp());
        else
          attendeeRepo.insertExternal(
              eventId, s.externalEmail(), s.externalName(), s.role(), s.rsvp());
        changed = true;
      } else if (!"ORGANIZER".equals(s.role()) && !s.rsvp().equals(existingRsvp.get(e.getKey()))) {
        // RSVP 변경 반영(조직자는 항상 ACCEPTED 고정 — 갱신 안 함).
        if (s.userId() != null) attendeeRepo.updateRsvp(eventId, s.userId(), s.rsvp());
        else attendeeRepo.updateRsvpByExternalEmail(eventId, s.externalEmail(), s.rsvp());
        changed = true;
      }
    }
    return changed;
  }

  /**
   * Outlook 범주 → 캘린더 주인의 태그(WP-714). 범주 이름으로 주인의 태그를 찾고(대소문자 무시, 없으면 이름 해시 색으로 만든다) 일정마다 OUTLOOK 출처
   * 연결을 범주 목록과 똑같이 맞춘다. 앱에서 붙인 연결(APP)·다른 사람의 태그는 건드리지 않는다.
   *
   * <p>달력 하나의 일정을 모아 배치로 처리한다: 이름 → 태그 id 한 번, 연결 맞추기 한 번({@link
   * CalendarTagRepository#replaceOutlookLinks} — 바뀐 연결만 지우고 넣는다). 범주 이름은 API 의 50자 제한을 받지 않는다 —
   * Outlook 이 허용한 이름을 그대로 쓴다(최대 255).
   */
  private void syncCategoryTags(long userId, Map<Long, List<String>> categoriesByEvent) {
    if (categoriesByEvent.isEmpty()) return;
    Set<String> names = new LinkedHashSet<>();
    for (List<String> cats : categoriesByEvent.values()) {
      for (String c : cats) {
        String n = cleanCategory(c);
        if (n != null) names.add(n);
      }
    }
    // 키는 정리한 범주 이름 그대로 — 대소문자 접기는 DB(lower)만 한다(Java 와 PG 의 소문자 규칙이 어긋나는 이름에서 연결이 빠지지 않게).
    Map<String, Long> tagIdByName =
        tagRepo.findOrCreateByNames(userId, names, CalendarPalette::forName);
    Map<Long, Set<Long>> wantByEvent = new HashMap<>();
    for (var entry : categoriesByEvent.entrySet()) {
      Set<Long> want = new HashSet<>();
      for (String c : entry.getValue()) {
        String n = cleanCategory(c);
        if (n != null) want.add(tagIdByName.get(n));
      }
      want.removeIf(Objects::isNull);
      wantByEvent.put(entry.getKey(), want);
    }
    tagRepo.replaceOutlookLinks(userId, wantByEvent);
  }

  /** 범주 이름 정리 — 앞뒤 공백 제거, 빈 이름은 버리고 컬럼 상한(255)을 넘으면 자른다. */
  private static String cleanCategory(String raw) {
    if (raw == null) return null;
    String n = raw.strip();
    if (n.isEmpty()) return null;
    return n.length() > 255 ? n.substring(0, 255) : n;
  }

  /** 이메일 → 내부 user(매칭) 또는 외부 스펙 결정. */
  private Spec resolveSpec(
      String name,
      String email,
      String role,
      String rsvp,
      long syncUserId,
      String syncAccountEmail) {
    // ① 동기화 계정 이메일(alias/proxy 포함) → 동기화 user
    if (syncAccountEmail != null && syncAccountEmail.equalsIgnoreCase(email)) {
      return new Spec(syncUserId, null, null, role, rsvp);
    }
    // ② 내부 user 이메일 매칭
    Long matched = userRepo.findByEmailIgnoreCase(email).map(u -> u.id()).orElse(null);
    if (matched != null) return new Spec(matched, null, null, role, rsvp);
    // ③ 외부 참석자 행
    return new Spec(null, email, name, role, rsvp);
  }

  /** 내부/외부 참석자 동일성 키. */
  private static String identity(Long userId, String externalEmail) {
    return userId != null ? "U:" + userId : "E:" + externalEmail.toLowerCase();
  }

  /**
   * Graph calendarColor → 팔레트 키 변환.
   *
   * <p>COLOR_MAP 조회 후 CalendarPalette.isValid() 검증 — 미인식 또는 팔레트 외 키는 blue 폴백.
   */
  /**
   * Graph 색 → 팔레트 키 해석. 매핑이 유효하고 이 계정에서 아직 안 쓰였으면 그대로 사용, 아니면(dead key 또는 다른 캘린더와 충돌) {@link
   * #PALETTE_ORDER} 순서로 미사용 키를 찾아 대체한다 — 한 계정 안의 여러 캘린더가 전부 blue 로 수렴하던 문제(#825) 방지.
   */
  private static String resolveColor(String graphColor, Set<String> usedByAccount) {
    String mapped = graphColor == null ? null : COLOR_MAP.get(graphColor);
    if (CalendarPalette.isValid(mapped) && !usedByAccount.contains(mapped)) {
      return mapped;
    }
    for (String candidate : PALETTE_ORDER) {
      if (!usedByAccount.contains(candidate)) return candidate;
    }
    // 캘린더가 8개를 초과하는 극단적인 경우 — 더 이상 배정할 미사용 색이 없으므로 기본값으로 폴백.
    return CalendarPalette.DEFAULT;
  }
}
