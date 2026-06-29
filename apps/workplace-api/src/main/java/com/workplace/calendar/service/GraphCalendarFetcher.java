package com.workplace.calendar.service;

import com.workplace.calendar.CalendarPalette;
import com.workplace.calendar.repository.ExternalCalendarRepository;
import com.workplace.calendar.repository.ExternalCalendarRepository.ExternalEventRow;
import com.workplace.mail.dto.EmailAccountResponse;
import com.workplace.mail.dto.MailProvider;
import com.workplace.mail.outbound.GraphCalendarClient;
import com.workplace.mail.outbound.GraphCalendarClient.GraphCalendar;
import com.workplace.mail.outbound.GraphCalendarClient.GraphEvent;
import com.workplace.mail.service.GraphTokenService;
import java.time.LocalDateTime;
import java.time.OffsetDateTime;
import java.time.Period;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
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
   * <p>CalendarPalette.isValid() 검증 후 사용 — 미인식/팔레트 외 키는 blue 폴백. orange·yellow·brown 은 팔레트에 없으므로 실제
   * 폴백 결과는 blue 다.
   */
  private static final Map<String, String> COLOR_MAP =
      Map.of(
          "lightBlue", "blue",
          "lightGreen", "green",
          "lightOrange", "orange",
          "lightRed", "red",
          "lightYellow", "yellow",
          "lightTeal", "teal",
          "lightPink", "pink",
          "lightBrown", "brown",
          "lightGray", "gray");

  private final GraphTokenService tokenService;
  private final GraphCalendarClient graphClient;
  private final ExternalCalendarRepository extRepo;

  /**
   * 짧은-트랜잭션용 TransactionTemplate — @Primary TenantAwareTransactionManager 로 구성해 트랜잭션 진입 시 RLS
   * GUC(app.tenant_id) 가 주입된다(#444/#492 패턴).
   */
  private final TransactionTemplate txTemplate;

  public GraphCalendarFetcher(
      GraphTokenService tokenService,
      GraphCalendarClient graphClient,
      ExternalCalendarRepository extRepo,
      PlatformTransactionManager txManager) {
    this.tokenService = tokenService;
    this.graphClient = graphClient;
    this.extRepo = extRepo;
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
   * @return upsert 된 총 이벤트 수
   */
  @Override
  public int sync(long userId, long accountId, EmailAccountResponse account) {
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
    int totalUpserted = 0;
    Set<Long> seenCalendarIds = new HashSet<>();

    for (CalendarBatch batch : batches) {
      GraphCalendar cal = batch.calendar();
      List<GraphEvent> events = batch.events();
      String color = resolveColor(cal.color());

      int[] count = {0};
      long[] calIdHolder = {0L};

      txTemplate.execute(
          status -> {
            // canEdit=false(공휴일·생일 등) → is_read_only=true, canEdit=true → is_read_only=false
            long calId =
                extRepo.upsertExternalCalendar(
                    userId, accountId, cal.id(), cal.name(), color, !cal.canEdit());
            calIdHolder[0] = calId;

            Set<String> keep = new HashSet<>();
            for (GraphEvent evt : events) {
              if (evt.isCancelled()) {
                // 취소된 이벤트는 upsert 생략 — keep 에도 미추가하여 prune 대상으로 처리
                continue;
              }
              ExternalEventRow row = mapEvent(evt);
              extRepo.upsertExternalEvent(userId, calId, evt.id(), row);
              keep.add(evt.id());
              count[0]++;
            }
            extRepo.pruneEventsNotIn(calId, keep, from, to);
            return null;
          });

      seenCalendarIds.add(calIdHolder[0]);
      totalUpserted += count[0];
    }

    // 컨테이너 reconcile: 공급자에서 사라진 달력(기존 컨테이너에서 이번 동기화에서 미수신) 삭제.
    // 빈 목록 가드: Graph API 가 일시적으로 빈 응답(value:[])을 반환하면 모든 컨테이너를 삭제하게 되므로,
    // 실제로 1개 이상의 달력을 수신한 경우에만 reconcile-delete 를 실행한다.
    if (!calendars.isEmpty()) {
      txTemplate.execute(
          status -> {
            List<Long> existing = extRepo.listExternalCalendarIds(accountId);
            for (long existingId : existing) {
              if (!seenCalendarIds.contains(existingId)) {
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
    return totalUpserted;
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
   * GraphEvent → ExternalEventRow 매핑.
   *
   * <p>종일 이벤트: Graph end 는 배타적(다음 날 자정)이며 DB 도 동일 반개구간(half-open) 규약을 사용하므로 변환 없이 그대로 저장한다. {@code
   * calendar_event_time_check(ends_at > starts_at)} 제약상 포함 종료일로 보정하면 1일 이벤트 시 위반이 발생한다. 빈/null 제목은
   * "(제목 없음)"로 폴백. bodyPreview 빈 문자열은 null 로 저장.
   */
  private static ExternalEventRow mapEvent(GraphEvent evt) {
    String title = (evt.subject() == null || evt.subject().isBlank()) ? "(제목 없음)" : evt.subject();
    String description =
        (evt.bodyPreview() == null || evt.bodyPreview().isBlank()) ? null : evt.bodyPreview();
    String location = (evt.location() != null) ? evt.location().displayName() : null;

    OffsetDateTime startsAt = parseDateTime(evt.start().dateTime());
    OffsetDateTime endsAt = parseDateTime(evt.end().dateTime());

    // 종일 이벤트: Graph end 는 배타적이나 minusDays(1) 하면 start == end 가 되어
    // calendar_event_time_check(ends_at > starts_at) 위반 — DB 는 반개구간(exclusive end) 을 그대로 저장한다.
    // 앱 내 all_day=true 이벤트는 일관되게 half-open [start, end) 으로 표현한다(CalendarEventService 기준).

    return new ExternalEventRow(title, description, startsAt, endsAt, evt.isAllDay(), location);
  }

  /**
   * Graph calendarColor → 팔레트 키 변환.
   *
   * <p>COLOR_MAP 조회 후 CalendarPalette.isValid() 검증 — 미인식 또는 팔레트 외 키는 blue 폴백.
   */
  private static String resolveColor(String graphColor) {
    if (graphColor == null) return CalendarPalette.DEFAULT;
    String mapped = COLOR_MAP.getOrDefault(graphColor, CalendarPalette.DEFAULT);
    return CalendarPalette.isValid(mapped) ? mapped : CalendarPalette.DEFAULT;
  }
}
