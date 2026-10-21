package com.workplace.calendar.service;

import com.workplace.calendar.CalendarPalette;
import com.workplace.calendar.repository.CalendarTagRepository;
import com.workplace.calendar.repository.CalendarTagRepository.EventTagLink;
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
    // 계정 안의 캘린더끼리 색이 겹치지 않도록 이번 sync 호출 동안 배정된 색을 추적한다 (#825).
    Set<String> usedColorsForAccount = new HashSet<>();

    for (CalendarBatch batch : batches) {
      GraphCalendar cal = batch.calendar();
      List<GraphEvent> events = batch.events();
      String color = resolveColor(cal.color(), usedColorsForAccount);
      usedColorsForAccount.add(color);

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
            // 로컬 일정 id → Outlook 범주 이름(응답에 categories 가 있던 일정만) — 달력 단위로 모아 태그를 한 번에 맞춘다(WP-714).
            Map<Long, List<String>> categoriesByEvent = new HashMap<>();
            for (GraphEvent evt : events) {
              if (evt.isCancelled()) {
                // 취소된 이벤트는 upsert 생략 — keep 에도 미추가하여 prune 대상으로 처리
                continue;
              }
              ExternalEventRow row = mapEvent(evt);
              long localEventId = extRepo.upsertExternalEvent(userId, calId, evt.id(), row);
              // writable 캘린더의 일정만 참석자 동기화(공휴일·생일 등 read-only 는 skip).
              if (cal.canEdit()) {
                syncAttendees(localEventId, evt, userId, account.emailAddress());
              }
              // 범주 → 태그도 쓸 수 있는 달력만(WP-714 리뷰) — 동료가 공유한 달력·공휴일·생일 같은 읽기 전용 달력의 범주는 남의 사서함 것이라,
              // 내 태그로 만들면 지울 수도 없는 태그가 쌓인다. 참석자 동기화와 같은 기준(cal.canEdit())이다.
              if (cal.canEdit() && evt.categories() != null) {
                categoriesByEvent.put(localEventId, evt.categories());
              }
              keep.add(evt.id());
              count[0]++;
            }
            syncCategoryTags(userId, categoriesByEvent);
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

  /** CRLF·CR → LF 로 맞추고 NUL(Postgres 텍스트에 저장 불가)을 지운 뒤 앞뒤 공백을 자른다. null 은 빈 문자열. */
  private static String normalizeText(String raw) {
    if (raw == null) return "";
    return raw.replace("\r\n", "\n").replace('\r', '\n').replace("\u0000", "").trim();
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
    OffsetDateTime endsAt = parseDateTime(evt.end().dateTime());

    // 종일 이벤트: Graph end 는 배타적이나 minusDays(1) 하면 start == end 가 되어
    // calendar_event_time_check(ends_at > starts_at) 위반 — DB 는 반개구간(exclusive end) 을 그대로 저장한다.
    // 앱 내 all_day=true 이벤트는 일관되게 half-open [start, end) 으로 표현한다(CalendarEventService 기준).

    return new ExternalEventRow(
        title,
        description,
        startsAt,
        endsAt,
        evt.isAllDay(),
        location,
        evt.iCalUId(),
        mapJoinUrl(evt));
  }

  /**
   * 한 외부 일정의 참석자를 Graph organizer+attendees 와 일치하도록 diff-upsert 한다.
   *
   * <p>이메일 매칭: ① 동기화 계정 이메일이면 동기화 user, ② findByEmailIgnoreCase, ③ 외부 행. organizer 는
   * ORGANIZER/ACCEPTED, attendees 는 ATTENDEE + responseStatus 매핑. target 에 없는 기존 행은 삭제(organizer 는
   * target 에 항상 포함돼 보존).
   */
  private void syncAttendees(
      long eventId, GraphEvent evt, long syncUserId, String syncAccountEmail) {
    boolean hasAttendees = evt.attendees() != null && !evt.attendees().isEmpty();
    boolean hasOrganizer =
        evt.organizer() != null
            && evt.organizer().emailAddress() != null
            && evt.organizer().emailAddress().address() != null;
    if (!hasAttendees && !hasOrganizer) return; // 참석자 정보 없음 — 건드리지 않음

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

    // 3) 삭제: 기존에 있지만 target 에 없는 행.
    for (var r : existing) {
      // AGENT 는 Graph 에 전송하지 않는 로컬 전용 구성 — sync 가 지우면 안 됨.
      if ("AGENT".equals(r.kind())) continue;
      String id = identity(r.userId(), r.externalEmail());
      if (!target.containsKey(id)) {
        if (r.userId() != null) attendeeRepo.deleteByEventAndUser(eventId, r.userId());
        else attendeeRepo.deleteByEventAndExternalEmail(eventId, r.externalEmail());
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
      } else if (!"ORGANIZER".equals(s.role()) && !s.rsvp().equals(existingRsvp.get(e.getKey()))) {
        // RSVP 변경 반영(조직자는 항상 ACCEPTED 고정 — 갱신 안 함).
        if (s.userId() != null) attendeeRepo.updateRsvp(eventId, s.userId(), s.rsvp());
        else attendeeRepo.updateRsvpByExternalEmail(eventId, s.externalEmail(), s.rsvp());
      }
    }
  }

  /**
   * Outlook 범주 → 캘린더 주인의 태그(WP-714). 범주 이름으로 주인의 태그를 찾고(대소문자 무시, 없으면 이름 해시 색으로 만든다) 일정마다 OUTLOOK 출처
   * 연결을 범주 목록과 똑같이 맞춘다. 앱에서 붙인 연결(APP)·다른 사람의 태그는 건드리지 않는다.
   *
   * <p>달력 하나의 일정을 모아 배치로 처리한다: 이름 → 태그 id 한 번, 기존 OUTLOOK 연결 한 번 읽고 바뀐 연결만 DELETE 한 문장·INSERT 한
   * 문장으로 지우고 넣는다(10분마다 도는 동기화가 매번 모든 연결을 다시 쓰지 않게). 범주 이름은 API 의 50자 제한을 받지 않는다 — Outlook 이 허용한 이름을
   * 그대로 쓴다(최대 255).
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
    Map<Long, Set<Long>> existing = tagRepo.outlookLinks(userId, categoriesByEvent.keySet());
    // 바뀐 연결만 모아 DELETE 하나·INSERT 하나로 보낸다(일정마다 두 문장씩 보내지 않게).
    List<EventTagLink> removes = new ArrayList<>();
    List<EventTagLink> adds = new ArrayList<>();
    for (var entry : categoriesByEvent.entrySet()) {
      long eventId = entry.getKey();
      Set<Long> want = new HashSet<>();
      for (String c : entry.getValue()) {
        String n = cleanCategory(c);
        if (n != null) want.add(tagIdByName.get(n));
      }
      want.removeIf(Objects::isNull);
      Set<Long> have = existing.getOrDefault(eventId, Set.of());
      for (Long tagId : have) {
        if (!want.contains(tagId)) removes.add(new EventTagLink(eventId, tagId));
      }
      for (Long tagId : want) {
        if (!have.contains(tagId)) adds.add(new EventTagLink(eventId, tagId));
      }
    }
    tagRepo.deleteOutlookLinks(removes);
    tagRepo.insertOutlookLinks(adds);
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
