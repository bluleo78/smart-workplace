package com.workplace.calendar.service;

import com.workplace.calendar.dto.CalendarEventResponse;
import com.workplace.calendar.dto.TagFeedResponse;
import com.workplace.calendar.exception.CalendarTagNotFoundException;
import com.workplace.calendar.exception.TagFeedNotFoundException;
import com.workplace.calendar.repository.CalendarEventExceptionRepository;
import com.workplace.calendar.repository.CalendarEventExceptionRepository.MasterOccurrence;
import com.workplace.calendar.repository.CalendarTagRepository;
import com.workplace.calendar.repository.CalendarTagRepository.FeedTagRow;
import com.workplace.calendar.repository.CalendarTagRepository.TagRow;
import com.workplace.calendar.repository.EventAttendeeRepository;
import com.workplace.calendar.repository.EventAttendeeRepository.AttendeeRow;
import com.workplace.global.ical.IcsWriter;
import com.workplace.global.tenant.MembershipGuard;
import com.workplace.global.util.CapabilityTokens;
import com.workplace.user.dto.UserResponse;
import com.workplace.user.repository.UserRepository;
import java.time.DayOfWeek;
import java.time.Instant;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.time.temporal.IsoFields;
import java.time.temporal.TemporalAdjusters;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.Set;
import java.util.function.Function;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Collectors;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 태그 구독 주소(WP-715) — 태그별 비밀 iCal 주소의 발급·재발급·폐기와, 그 주소로 들어온 공개 요청에 한 주치 일정을 .ics 로 내보내기.
 *
 * <p>사내 시스템이 Teams 초대 일정 일부를 주 단위로 가져가려는 용도다. 주소는 로그인 없이 열리므로 토큰(32바이트 난수 base64url)이 곧 권한이고,
 * Google 「비공개 주소」처럼 다시 보여 줘야 해서 원문을 저장한다 — 새는 일이 있으면 재발급으로 막는다. 설명(DESCRIPTION)은 내보내지 않는다(회의 링크·내부
 * 메모가 섞여 있어서).
 *
 * <p>공개 요청 순서(컨트롤러가 조립): {@link #resolve}(SECURITY DEFINER 함수, 테넌트 컨텍스트 없음) → 테넌트 활성 확인 → 컨트롤러가
 * TenantContext 설정 → {@link #render}(주인 멤버십 재확인 + 주인 기준 일정 목록 경로 재사용) → finally 에서 컨텍스트 정리.
 */
@Service
public class CalendarTagFeedService {
  /** 공개 구독 경로 — SecurityConfig permitAll 과 공개 컨트롤러 매핑이 같은 값을 쓴다. */
  public static final String PUBLIC_PATH = "/api/v1/public/calendar/feeds/";

  /** 주의 기준 시간대 — 사용자가 보는 날짜가 한국 날짜라 반복 전개(RecurrenceExpander)와 같은 기준을 쓴다. */
  static final ZoneId FEED_ZONE = ZoneId.of("Asia/Seoul");

  /** {@code ?week=2026-W43} 형식(ISO 주). */
  private static final Pattern WEEK = Pattern.compile("^(\\d{4})-W(\\d{2})$");

  /** 토큰 난수 바이트 수(256비트) — 발급({@link #create})과 형식 검사({@link #TOKEN})가 이 값 하나에서 길이를 얻는다. */
  static final int TOKEN_BYTES = 32;

  /** 토큰 형식 — base64url(패딩 없음) 43자. 형식이 다르면 DB 를 보지 않고 404. */
  private static final Pattern TOKEN =
      Pattern.compile("^[A-Za-z0-9_-]{" + CapabilityTokens.urlSafeLength(TOKEN_BYTES) + "}$");

  private static final String PRODID = "-//Genia Works//Calendar Tag Feed//KO";

  private final CalendarTagRepository tagRepo;
  // 태그 주인 확인을 CalendarTagService 와 한 곳에서 한다(404 은닉 규칙이 갈라지지 않게).
  private final CalendarTagService tagService;
  private final CalendarEventService eventService;
  private final CalendarEventExceptionRepository exceptionRepo;
  private final EventAttendeeRepository attendeeRepo;
  private final UserRepository userRepo;
  private final MembershipGuard membershipGuard;

  /** 외부에서 닿는 웹 기준 주소(끝 슬래시 제거) — 드라이브 전송 링크·스테이징 업로드 링크와 같은 설정. */
  private final String publicBaseUrl;

  public CalendarTagFeedService(
      CalendarTagRepository tagRepo,
      CalendarTagService tagService,
      CalendarEventService eventService,
      CalendarEventExceptionRepository exceptionRepo,
      EventAttendeeRepository attendeeRepo,
      UserRepository userRepo,
      MembershipGuard membershipGuard,
      @Value("${workplace.public-base-url}") String publicBaseUrl) {
    this.tagRepo = tagRepo;
    this.tagService = tagService;
    this.eventService = eventService;
    this.exceptionRepo = exceptionRepo;
    this.attendeeRepo = attendeeRepo;
    this.userRepo = userRepo;
    this.membershipGuard = membershipGuard;
    this.publicBaseUrl = CapabilityTokens.normalizeBaseUrl(publicBaseUrl);
  }

  // ── 발급·조회·폐기(로그인 사용자) ─────────────────────────────────────────────

  /** 구독 주소 조회 — 남의 태그는 404, 주소가 없으면 404(화면은 「만들기」를 보인다). */
  @Transactional(readOnly = true)
  public TagFeedResponse get(long callerId, long tagId) {
    TagRow tag = tagService.requireOwned(callerId, tagId);
    if (tag.feedToken() == null) throw new TagFeedNotFoundException();
    return toResponse(tag.id(), tag.feedToken(), tag.feedCreatedAt());
  }

  /** 발급·재발급 — 새 토큰으로 바꾸고 이전 주소는 바로 무효가 된다. */
  @Transactional
  public TagFeedResponse create(long callerId, long tagId) {
    tagService.requireOwned(callerId, tagId);
    String token = CapabilityTokens.generateUrlSafe(TOKEN_BYTES);
    OffsetDateTime now = OffsetDateTime.now(ZoneOffset.UTC);
    tagRepo.setFeedToken(tagId, token, now);
    return toResponse(tagId, token, now);
  }

  /** 폐기 — 그 주소는 바로 막힌다. 주소가 없어도 성공(멱등). */
  @Transactional
  public void delete(long callerId, long tagId) {
    tagService.requireOwned(callerId, tagId);
    tagRepo.clearFeedToken(tagId);
  }

  // ── 공개 피드 ─────────────────────────────────────────────────────────────

  /** 공개 토큰 → 태그·테넌트·주인. 형식이 틀린 토큰은 DB 를 보지 않고 빈 값. 테넌트 컨텍스트 없이 부른다(SECURITY DEFINER 함수). */
  public Optional<FeedTagRow> resolve(String token) {
    if (token == null || !TOKEN.matcher(token).matches()) return Optional.empty();
    return tagRepo.resolveFeedToken(token);
  }

  /**
   * {@code ?week=} 값 → 그 ISO 주의 월요일(한국 날짜). 없으면 오늘이 든 주. 형식이 틀리거나 그 해에 없는 주(예: 52주인 해의 W53)면
   * IllegalArgumentException(400).
   */
  public static LocalDate weekStart(String week, LocalDate today) {
    if (week == null || week.isBlank()) {
      return today.with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY));
    }
    Matcher m = WEEK.matcher(week.strip());
    if (!m.matches()) {
      throw new IllegalArgumentException("week 는 2026-W43 형식이어야 합니다");
    }
    int year = Integer.parseInt(m.group(1));
    int w = Integer.parseInt(m.group(2));
    // 1월 4일은 언제나 그 해의 1주차에 든다 — 그 날 기준으로 주 수 범위(52·53)를 구한다.
    LocalDate jan4 = LocalDate.of(year, 1, 4);
    long maxWeek = IsoFields.WEEK_OF_WEEK_BASED_YEAR.rangeRefinedBy(jan4).getMaximum();
    if (w < 1 || w > maxWeek) {
      throw new IllegalArgumentException(year + "년에는 " + w + "주차가 없습니다");
    }
    return jan4.with(IsoFields.WEEK_OF_WEEK_BASED_YEAR, w)
        .with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY));
  }

  /** 오늘(한국 날짜). */
  public static LocalDate today() {
    return LocalDate.now(FEED_ZONE);
  }

  /**
   * 한 주(월 00:00 ~ 다음 월 00:00, 한국 시간)와 겹치는, 이 태그가 붙은 일정을 .ics 로 만든다. 호출부가 TenantContext 를 태그의 테넌트로
   * 설정한 뒤 부른다.
   *
   * <p>보통 목록과 같은 규칙({@link CalendarEventService#listTagged})으로 모으되 태그 조건을 SQL 에 걸어, 이 태그가 붙은 일정(앱
   * 반복은 마스터, M365 는 회차 행, 고친 회차는 마스터의 태그를 따른다)만 날짜 범위 안에서 읽어 펼친다 — 반복 회차 전개·취소/고친 회차·중복 제거·끊긴 계정
   * 숨기기가 화면과 똑같이 적용되면서, 태그 없는 일정은 읽지도 펼치지도 않는다. 참석자는 남은 일정에 대해서만 한 번 읽는다.
   *
   * @throws CalendarTagNotFoundException 주인이 더는 이 워크스페이스의 활성 구성원이 아님(존재 은닉 404)
   */
  @Transactional(readOnly = true)
  public String render(FeedTagRow tag, LocalDate monday) {
    if (membershipGuard.isForeignUser(tag.userId())) throw new CalendarTagNotFoundException();
    LocalDate nextMonday = monday.plusWeeks(1);
    OffsetDateTime from = monday.atStartOfDay(FEED_ZONE).toOffsetDateTime();
    OffsetDateTime to = nextMonday.atStartOfDay(FEED_ZONE).toOffsetDateTime();

    // 종일 일정은 저장 시각이 출처마다 달라(앱 = 한국 자정, M365 = UTC 자정) 날짜로 다시 거른다 — 넉넉히 하루씩 더 읽는다.
    // 태그 거르기(고친 회차는 마스터 태그를 따름)는 SQL 이 끝냈다. 결과는 시작 시각순이다.
    List<CalendarEventResponse> events =
        eventService.listTagged(tag.userId(), from.minusDays(1), to.plusDays(1), tag.id()).stream()
            .filter(e -> overlapsWeek(e, from, to, monday, nextMonday))
            .toList();
    // 고친 회차는 원래 회차의 UID 를 써야 해서 마스터·회차를 역조회한다(가상 회차는 마스터 id 를 이미 안다).
    Set<Long> concrete =
        events.stream()
            .filter(e -> e.masterEventId() == null)
            .map(CalendarEventResponse::id)
            .collect(Collectors.toSet());
    Map<Long, MasterOccurrence> overrides = exceptionRepo.mastersByOverrides(concrete);

    Map<Long, List<AttendeeRow>> people = peopleByEvent(events);
    Map<Long, UserResponse> users = usersOf(people);

    IcsWriter ics =
        new IcsWriter()
            .raw("BEGIN", "VCALENDAR")
            .raw("VERSION", "2.0")
            .raw("PRODID", PRODID)
            .raw("CALSCALE", "GREGORIAN")
            .text("X-WR-CALNAME", tag.name());
    Instant now = Instant.now();
    for (CalendarEventResponse e : events) {
      writeEvent(
          ics,
          e,
          overrides.get(e.id()),
          people.getOrDefault(attendeeKey(e), List.of()),
          users,
          now);
    }
    return ics.raw("END", "VCALENDAR").build();
  }

  /** VEVENT 하나 — UID·DTSTAMP·시각·제목·장소·주최자·참석자. 설명은 넣지 않는다. */
  private static void writeEvent(
      IcsWriter ics,
      CalendarEventResponse e,
      MasterOccurrence override,
      List<AttendeeRow> people,
      Map<Long, UserResponse> users,
      Instant now) {
    ics.raw("BEGIN", "VEVENT").text("UID", uidOf(e, override));
    ics.utc("DTSTAMP", e.updatedAt() != null ? e.updatedAt().toInstant() : now);
    if (e.allDay()) {
      AllDaySpan span = allDaySpan(e);
      ics.date("DTSTART", span.start()).date("DTEND", span.endExclusive());
    } else {
      ics.utc("DTSTART", e.startsAt().toInstant()).utc("DTEND", e.endsAt().toInstant());
    }
    ics.text("SUMMARY", e.title()).text("LOCATION", e.location());
    for (AttendeeRow p : people) {
      if (p.userId() != null && "AGENT".equals(p.kind())) continue; // AI 에이전트는 바깥 시스템의 사람이 아니다
      String email = p.userId() != null ? emailOf(users.get(p.userId())) : p.externalEmail();
      if ("ORGANIZER".equals(p.role())) {
        ics.person("ORGANIZER", p.name(), email, null);
      } else {
        ics.person("ATTENDEE", p.name(), email, partStat(p.rsvpStatus()));
      }
    }
    ics.raw("END", "VEVENT");
  }

  /**
   * UID 규칙 — M365 일정은 공급자 iCalUId 그대로(반복 회의는 회차마다 다르다), 앱 일정은 {@code wp-event-{id}@genia-works}, 앱
   * 반복 회차는 {@code wp-event-{마스터}-{원래 회차 시작 UTC}@genia-works}. 고친 회차는 자기 id 가 아니라 원래 회차의 UID 를 써서,
   * 받는 쪽이 같은 회차로 알아보게 한다.
   */
  static String uidOf(CalendarEventResponse e, MasterOccurrence override) {
    if (e.iCalUid() != null && !e.iCalUid().isBlank()) return e.iCalUid();
    if (e.masterEventId() != null) return appUid(e.masterEventId(), e.startsAt().toInstant());
    if (override != null) return appUid(override.eventId(), override.occurrenceDate().toInstant());
    return appUid(e.id(), null);
  }

  /** 앱 일정 UID — occurrence 가 있으면 반복 회차({@code wp-event-{id}-{회차 UTC}@genia-works}), 없으면 단일 일정. */
  private static String appUid(long id, Instant occurrence) {
    String suffix = occurrence == null ? "" : "-" + IcsWriter.UTC_FMT.format(occurrence);
    return "wp-event-" + id + suffix + "@genia-works";
  }

  /**
   * 종일 일정의 날짜 — 저장 시각에 12시간을 더한 UTC 날짜. 앱 종일은 한국 자정(전날 15:00Z), M365 종일은 UTC 자정으로 저장돼 있어, 이렇게 하면 둘
   * 다 의도한 날짜가 된다(Graph 쓰기의 toGraphDateTime 과 같은 규칙).
   */
  static LocalDate allDayDate(OffsetDateTime t) {
    return t.withOffsetSameInstant(ZoneOffset.UTC).plusHours(12).toLocalDate();
  }

  /** 종일 일정의 날짜 구간 [start, endExclusive) — 끝이 시작보다 늦지 않으면(0일·뒤집힘) 하루짜리로 본다. */
  private record AllDaySpan(LocalDate start, LocalDate endExclusive) {}

  /** 종일 일정의 정규화한 날짜 구간 — VEVENT 의 DTSTART/DTEND 와 주 겹침 판정이 같은 값을 쓴다. */
  private static AllDaySpan allDaySpan(CalendarEventResponse e) {
    LocalDate start = allDayDate(e.startsAt());
    LocalDate end = allDayDate(e.endsAt());
    return new AllDaySpan(start, end.isAfter(start) ? end : start.plusDays(1));
  }

  /** 그 주와 겹치는가 — 시각 일정은 [from,to) 겹침, 종일 일정은 날짜 [monday, nextMonday) 겹침. */
  private static boolean overlapsWeek(
      CalendarEventResponse e,
      OffsetDateTime from,
      OffsetDateTime to,
      LocalDate monday,
      LocalDate nextMonday) {
    if (e.allDay()) {
      AllDaySpan span = allDaySpan(e);
      return span.start().isBefore(nextMonday) && span.endExclusive().isAfter(monday);
    }
    return e.startsAt().isBefore(to) && e.endsAt().isAfter(from);
  }

  /** 참석자 행을 찾을 일정 키 — 가상 회차는 마스터(같은 참석자), 그 외(고친 회차 포함 — 마스터 참석자를 복사해 둔다)는 자기 id. */
  private static long attendeeKey(CalendarEventResponse e) {
    return e.masterEventId() != null ? e.masterEventId() : e.id();
  }

  /** 일정들의 참석자(주최자 포함) — 한 번에 읽는다. */
  private Map<Long, List<AttendeeRow>> peopleByEvent(List<CalendarEventResponse> events) {
    Set<Long> keys = new HashSet<>();
    for (CalendarEventResponse e : events) keys.add(attendeeKey(e));
    return attendeeRepo.findByEvents(keys).stream()
        .collect(Collectors.groupingBy(AttendeeRow::eventId));
  }

  /** 내부 참석자의 이메일을 얻으려고 사용자를 한 번에 읽는다. */
  private Map<Long, UserResponse> usersOf(Map<Long, List<AttendeeRow>> people) {
    List<Long> ids =
        people.values().stream()
            .flatMap(List::stream)
            .map(AttendeeRow::userId)
            .filter(Objects::nonNull)
            .distinct()
            .toList();
    if (ids.isEmpty()) return Map.of();
    return userRepo.findByIds(new ArrayList<>(ids)).stream()
        .collect(Collectors.toMap(UserResponse::id, Function.identity(), (a, b) -> a));
  }

  private static String emailOf(UserResponse u) {
    return u == null ? null : u.email();
  }

  /** iCalendar 로 옮길 수 있는 앱 RSVP 값 — 이름이 PARTSTAT 와 같고 밑줄만 하이픈으로 바뀐다. */
  private static final Set<String> PART_STATS =
      Set.of("ACCEPTED", "DECLINED", "TENTATIVE", "NEEDS_ACTION");

  /** 앱 RSVP → iCalendar PARTSTAT(NEEDS_ACTION → NEEDS-ACTION). 모르는 값은 생략. */
  private static String partStat(String rsvp) {
    return rsvp != null && PART_STATS.contains(rsvp) ? rsvp.replace('_', '-') : null;
  }

  private TagFeedResponse toResponse(long tagId, String token, OffsetDateTime createdAt) {
    return new TagFeedResponse(feedUrl(token), createdAt, tagRepo.countEvents(tagId));
  }

  /** 구독 전체 주소. */
  String feedUrl(String token) {
    return publicBaseUrl + PUBLIC_PATH + token + ".ics";
  }
}
