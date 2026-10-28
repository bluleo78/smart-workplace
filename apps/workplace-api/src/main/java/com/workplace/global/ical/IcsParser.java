package com.workplace.global.ical;

import com.workplace.global.ical.IcsInvite.Person;
import java.time.DateTimeException;
import java.time.Duration;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 작은 RFC 5545(iCalendar) 읽기(WP-986) — 메일에 실린 초대(METHOD:REQUEST)·취소(METHOD:CANCEL)에서 카드와 응답에 필요한 값만
 * 읽는다.
 *
 * <p>무거운 라이브러리(ical4j 등)를 들이지 않으려고 쓰는 만큼만 직접 읽는다({@link IcsWriter} 와 같은 이유):
 *
 * <ul>
 *   <li>줄 접기 풀기 — CRLF/LF 뒤 공백·탭 하나는 앞 줄에 잇는다.
 *   <li>이름;매개변수=값;매개변수="따옴표:값":값 — 따옴표 안의 {@code : ;} 는 구분자가 아니다.
 *   <li>시각: {@code Z}(UTC), {@code TZID=}(IANA 이름 → Windows 이름 표 → VTIMEZONE 의 표준시 오프셋 → UTC 순으로
 *       해석), 떠 있는 시각(TZID 없음)은 UTC 로 본다. {@code VALUE=DATE}(또는 8자리)는 종일 — 그 날짜의 UTC 자정.
 *   <li>VEVENT 가 여럿이면(반복 예외) RECURRENCE-ID 없는 것을 대표로, 없으면 첫 번째를 쓴다.
 * </ul>
 *
 * 형식이 깨졌거나 UID·DTSTART 가 없으면 빈 값 — 호출자는 초대가 없는 메일로 다룬다.
 */
public final class IcsParser {

  private IcsParser() {}

  private static final DateTimeFormatter LOCAL_DT =
      DateTimeFormatter.ofPattern("yyyyMMdd'T'HHmmss");
  private static final DateTimeFormatter DATE = DateTimeFormatter.ofPattern("yyyyMMdd");

  /**
   * 지울 제어 문자 — 줄바꿈(CR·LF)과 탭만 남긴다. NUL(0x00)은 PostgreSQL TEXT 에 넣을 수 없어(INSERT 가 트랜잭션을 깬다) 메일
   * 원문(quoted-printable {@code =00} 등)에 섞여 와도 미리 지운다.
   */
  private static final Pattern CONTROL = Pattern.compile("[\\x00-\\x08\\x0B\\x0C\\x0E-\\x1F\\x7F]");

  /** 받아들이는 시각의 연도 범위 — 그 밖(PostgreSQL TIMESTAMPTZ 상한·DURATION 폭주·0001년 등)은 깨진 값으로 본다. */
  static final int MIN_YEAR = 1900;

  static final int MAX_YEAR = 9999;

  /** DURATION 의 주 단위(P1W) — java.time.Duration 이 읽지 못해 따로 본다. */
  private static final Pattern WEEKS = Pattern.compile("^([+-]?)P(\\d+)W$");

  /**
   * Outlook·Exchange 가 TZID 에 쓰는 Windows 시간대 이름 → IANA. 자주 보이는 것만 둔다 — 없는 이름은 VTIMEZONE 의 오프셋으로
   * 내려간다.
   */
  private static final Map<String, String> WINDOWS_ZONES =
      Map.ofEntries(
          Map.entry("Korea Standard Time", "Asia/Seoul"),
          Map.entry("Tokyo Standard Time", "Asia/Tokyo"),
          Map.entry("China Standard Time", "Asia/Shanghai"),
          Map.entry("Taipei Standard Time", "Asia/Taipei"),
          Map.entry("Singapore Standard Time", "Asia/Singapore"),
          Map.entry("India Standard Time", "Asia/Kolkata"),
          Map.entry("SE Asia Standard Time", "Asia/Bangkok"),
          Map.entry("AUS Eastern Standard Time", "Australia/Sydney"),
          Map.entry("GMT Standard Time", "Europe/London"),
          Map.entry("Greenwich Standard Time", "Atlantic/Reykjavik"),
          Map.entry("W. Europe Standard Time", "Europe/Berlin"),
          Map.entry("Romance Standard Time", "Europe/Paris"),
          Map.entry("Central Europe Standard Time", "Europe/Budapest"),
          Map.entry("Central European Standard Time", "Europe/Warsaw"),
          Map.entry("Eastern Standard Time", "America/New_York"),
          Map.entry("Central Standard Time", "America/Chicago"),
          Map.entry("Mountain Standard Time", "America/Denver"),
          Map.entry("Pacific Standard Time", "America/Los_Angeles"),
          Map.entry("UTC", "UTC"),
          Map.entry("Coordinated Universal Time", "UTC"));

  /** 한 논리 줄 — 이름(대문자), 매개변수(이름 대문자 → 값), 값. */
  record Line(String name, Map<String, String> params, String value) {
    String param(String key) {
      return params.get(key);
    }
  }

  /** iCalendar 문자열에서 초대 한 건을 읽는다. 초대로 볼 수 없으면 빈 값. */
  public static Optional<IcsInvite> parse(String ics) {
    if (ics == null || ics.isBlank()) return Optional.empty();
    try {
      return Optional.ofNullable(doParse(unfold(stripControl(ics))));
    } catch (RuntimeException e) {
      // 깨진 ICS 는 초대 없음으로 — 메일 본문 적재를 막지 않는다
      return Optional.empty();
    }
  }

  private static IcsInvite doParse(List<Line> lines) {
    String method = null;
    Map<String, ZoneOffset> vtimezoneOffsets = new HashMap<>();
    List<List<Line>> events = new ArrayList<>();
    List<Line> current = null;
    String tzid = null;
    boolean inStandard = false;
    int depth = 0; // VEVENT 안의 하위 컴포넌트(VALARM 등) 깊이
    for (Line l : lines) {
      String n = l.name();
      if (n.equals("BEGIN")) {
        String comp = l.value().trim().toUpperCase(Locale.ROOT);
        if (comp.equals("VEVENT") && current == null) {
          current = new ArrayList<>();
        } else if (current != null) {
          depth++;
        } else if (comp.equals("STANDARD")) {
          inStandard = true;
        }
        continue;
      }
      if (n.equals("END")) {
        String comp = l.value().trim().toUpperCase(Locale.ROOT);
        if (current != null) {
          if (depth > 0) {
            depth--;
          } else if (comp.equals("VEVENT")) {
            events.add(current);
            current = null;
          }
        } else if (comp.equals("STANDARD")) {
          inStandard = false;
        } else if (comp.equals("VTIMEZONE")) {
          tzid = null;
        }
        continue;
      }
      if (current != null) {
        if (depth == 0) current.add(l);
        continue;
      }
      switch (n) {
        case "METHOD" -> method = l.value().trim().toUpperCase(Locale.ROOT);
        case "TZID" -> tzid = l.value().trim();
        case "TZOFFSETTO" -> {
          // 표준시 오프셋만 — 서머타임은 근사하지 않는다(알 수 없는 이름의 마지막 대비)
          if (inStandard && tzid != null) {
            String zone = tzid;
            parseOffset(l.value()).ifPresent(o -> vtimezoneOffsets.put(zone, o));
          }
        }
        default -> {}
      }
    }
    if (events.isEmpty()) return null;
    List<Line> ev =
        events.stream()
            .filter(e -> e.stream().noneMatch(x -> x.name().equals("RECURRENCE-ID")))
            .findFirst()
            .orElse(events.get(0));
    return toInvite(method, ev, vtimezoneOffsets);
  }

  private static IcsInvite toInvite(
      String method, List<Line> ev, Map<String, ZoneOffset> vtimezoneOffsets) {
    String uid = null;
    int sequence = 0;
    String summary = null;
    String location = null;
    Line dtStart = null;
    Line dtEnd = null;
    String duration = null;
    Person organizer = null;
    boolean cancelled = false;
    Map<String, Person> attendees = new LinkedHashMap<>();
    for (Line l : ev) {
      switch (l.name()) {
        case "UID" -> uid = l.value().trim();
        case "SEQUENCE" -> {
          try {
            sequence = Integer.parseInt(l.value().trim());
          } catch (NumberFormatException ignored) {
            // 잘못된 SEQUENCE 는 0
          }
        }
        case "SUMMARY" -> summary = blankToNull(unescape(l.value()));
        case "LOCATION" -> location = blankToNull(unescape(l.value()));
        case "DTSTART" -> dtStart = l;
        case "DTEND" -> dtEnd = l;
        case "DURATION" -> duration = l.value().trim();
        case "STATUS" -> cancelled = "CANCELLED".equalsIgnoreCase(l.value().trim());
        case "ORGANIZER" -> organizer = person(l);
        case "ATTENDEE" -> {
          Person p = person(l);
          if (p != null) attendees.putIfAbsent(p.email(), p);
        }
        default -> {}
      }
    }
    if (uid == null || uid.isEmpty() || dtStart == null) return null;
    boolean allDay = isDate(dtStart);
    OffsetDateTime start = dateTime(dtStart, vtimezoneOffsets);
    // 시작이 범위 밖이면 초대로 보지 않는다 — 저장·일정 생성이 깨지지 않게
    if (!inRange(start)) return null;
    OffsetDateTime end = dtEnd != null ? dateTime(dtEnd, vtimezoneOffsets) : null;
    if (end == null && duration != null) {
      end = plusDuration(start, duration);
    }
    // 끝이 범위 밖이면 버린다(끝 없음 — 일정 반영은 기본 길이로 채운다)
    if (!inRange(end)) end = null;
    return new IcsInvite(
        method,
        uid,
        sequence,
        summary,
        start,
        end,
        allDay,
        location,
        organizer,
        List.copyOf(attendees.values()),
        cancelled);
  }

  /** ORGANIZER·ATTENDEE 줄 → 사람. mailto: 가 아니거나 이메일이 비면 null. */
  private static Person person(Line l) {
    String v = l.value().trim();
    if (v.regionMatches(true, 0, "mailto:", 0, 7)) {
      v = v.substring(7);
    } else if (!v.contains("@")) {
      return null;
    }
    v = v.trim().toLowerCase(Locale.ROOT);
    if (v.isEmpty()) return null;
    String partStat = l.param("PARTSTAT");
    return new Person(
        v,
        blankToNull(l.param("CN")),
        partStat == null ? null : partStat.trim().toUpperCase(Locale.ROOT));
  }

  private static boolean isDate(Line l) {
    String type = l.param("VALUE");
    return "DATE".equalsIgnoreCase(type) || l.value().trim().length() == 8;
  }

  /** DTSTART·DTEND 값 → 시각. 종일은 UTC 자정. */
  static OffsetDateTime dateTime(Line l, Map<String, ZoneOffset> vtimezoneOffsets) {
    String v = l.value().trim();
    if (isDate(l)) {
      return LocalDate.parse(v.substring(0, 8), DATE).atStartOfDay().atOffset(ZoneOffset.UTC);
    }
    if (v.endsWith("Z") || v.endsWith("z")) {
      return LocalDateTime.parse(v.substring(0, v.length() - 1), LOCAL_DT).atOffset(ZoneOffset.UTC);
    }
    LocalDateTime local = LocalDateTime.parse(v, LOCAL_DT);
    String tzid = l.param("TZID");
    if (tzid == null) return local.atOffset(ZoneOffset.UTC); // 떠 있는 시각 — 기준이 없어 UTC
    return resolveZone(tzid, vtimezoneOffsets)
        .map(z -> local.atZone(z).toOffsetDateTime())
        .orElseGet(() -> local.atOffset(ZoneOffset.UTC));
  }

  /** TZID → 시간대. IANA 이름, Windows 이름, VTIMEZONE 표준시 오프셋 순. 모르면 빈 값(UTC 로 본다). */
  static Optional<ZoneId> resolveZone(String rawTzid, Map<String, ZoneOffset> vtimezoneOffsets) {
    String tzid = rawTzid.trim();
    // 일부 클라이언트는 "/mozilla.org/20050126_1/Asia/Seoul" 처럼 앞에 경로를 붙인다 — 앞 조각을 하나씩 떼며 시도한다
    String candidate = tzid;
    while (true) {
      try {
        return Optional.of(ZoneId.of(candidate));
      } catch (DateTimeException ignored) {
        // 다음 후보
      }
      int slash = candidate.indexOf('/', 1);
      if (slash < 0) break;
      candidate = candidate.substring(slash + 1);
    }
    String windows = WINDOWS_ZONES.get(tzid);
    if (windows != null) return Optional.of(ZoneId.of(windows));
    ZoneOffset off = vtimezoneOffsets.get(rawTzid);
    if (off == null) off = vtimezoneOffsets.get(tzid);
    return Optional.ofNullable(off);
  }

  /** "+0900"·"-0500"·"+090000" → 오프셋. */
  private static Optional<ZoneOffset> parseOffset(String raw) {
    String v = raw.trim();
    if (v.length() < 5) return Optional.empty();
    try {
      int sign = v.charAt(0) == '-' ? -1 : 1;
      int h = Integer.parseInt(v.substring(1, 3));
      int m = Integer.parseInt(v.substring(3, 5));
      return Optional.of(ZoneOffset.ofHoursMinutes(sign * h, sign * m));
    } catch (RuntimeException e) {
      return Optional.empty();
    }
  }

  /** 시작 + DURATION(P1D·PT1H30M·P1W). 읽지 못하거나 넘치면(아주 큰 값) null. */
  private static OffsetDateTime plusDuration(OffsetDateTime start, String raw) {
    try {
      Matcher w = WEEKS.matcher(raw);
      if (w.matches()) {
        long weeks = Long.parseLong(w.group(2));
        return start.plusWeeks("-".equals(w.group(1)) ? -weeks : weeks);
      }
      return start.plus(Duration.parse(raw));
    } catch (RuntimeException e) {
      return null;
    }
  }

  /** 받아들이는 연도 범위({@value #MIN_YEAR}~{@value #MAX_YEAR}) 안의 시각인가. null 이면 false. */
  private static boolean inRange(OffsetDateTime t) {
    if (t == null) return false;
    int year = t.withOffsetSameInstant(ZoneOffset.UTC).getYear();
    return year >= MIN_YEAR && year <= MAX_YEAR;
  }

  /** 줄바꿈·탭을 뺀 제어 문자(NUL 포함)를 지운다. */
  static String stripControl(String s) {
    return CONTROL.matcher(s).replaceAll("");
  }

  /** 줄 접기를 풀고 논리 줄로 나눈다. 이름이 없는 줄은 버린다. */
  static List<Line> unfold(String ics) {
    String joined = ics.replace("\r\n", "\n").replace('\r', '\n').replaceAll("\n[ \t]", "");
    List<Line> out = new ArrayList<>();
    for (String raw : joined.split("\n")) {
      if (raw.isBlank()) continue;
      Line l = parseLine(raw);
      if (l != null) out.add(l);
    }
    return out;
  }

  /** 한 논리 줄을 이름·매개변수·값으로 나눈다. 따옴표 안의 {@code ; :} 는 구분자가 아니다. */
  static Line parseLine(String raw) {
    int i = 0;
    int len = raw.length();
    boolean quoted = false;
    int colon = -1;
    List<Integer> semis = new ArrayList<>();
    for (; i < len; i++) {
      char c = raw.charAt(i);
      if (c == '"') quoted = !quoted;
      else if (!quoted && c == ';') semis.add(i);
      else if (!quoted && c == ':') {
        colon = i;
        break;
      }
    }
    if (colon <= 0) return null;
    String head = raw.substring(0, colon);
    String value = raw.substring(colon + 1);
    int nameEnd = semis.isEmpty() ? head.length() : semis.get(0);
    String name = head.substring(0, nameEnd).trim().toUpperCase(Locale.ROOT);
    Map<String, String> params = new HashMap<>();
    for (int s = 0; s < semis.size(); s++) {
      int from = semis.get(s) + 1;
      int to = s + 1 < semis.size() ? semis.get(s + 1) : head.length();
      String p = head.substring(from, to);
      int eq = p.indexOf('=');
      if (eq <= 0) continue;
      String pv = p.substring(eq + 1).trim();
      if (pv.length() >= 2 && pv.startsWith("\"") && pv.endsWith("\"")) {
        pv = pv.substring(1, pv.length() - 1);
      }
      params.put(p.substring(0, eq).trim().toUpperCase(Locale.ROOT), pv);
    }
    return new Line(name, params, value);
  }

  /** TEXT 값 이스케이프 풀기(RFC 5545 3.3.11). */
  static String unescape(String v) {
    StringBuilder sb = new StringBuilder(v.length());
    for (int i = 0; i < v.length(); i++) {
      char c = v.charAt(i);
      if (c == '\\' && i + 1 < v.length()) {
        char n = v.charAt(++i);
        switch (n) {
          case 'n', 'N' -> sb.append('\n');
          default -> sb.append(n); // \\ \; \, 및 모르는 이스케이프는 글자 그대로
        }
      } else {
        sb.append(c);
      }
    }
    return sb.toString();
  }

  private static String blankToNull(String s) {
    if (s == null) return null;
    String t = s.strip();
    return t.isEmpty() ? null : t;
  }
}
