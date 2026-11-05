package com.workplace.issue.service;

import com.workplace.calendar.service.RecurrenceExpander;
import com.workplace.issue.exception.InvalidIssueRecurrenceException;
import java.time.DayOfWeek;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeParseException;
import java.util.Comparator;
import java.util.EnumSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;
import java.util.stream.Collectors;
import java.util.stream.Stream;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

/**
 * 이슈 반복(WP-989)의 규칙 검증과 다음 회차 계산. 매일·매주(요일)·매월(날짜)은 간격(INTERVAL) 1 만 받는다(하루 1회 단위). 가장 짧은 주기는 아래 「몇
 * 시간마다」의 1시간이다(WP-1373). 매일·매주·매월의 회차 전개는 캘린더 반복과 같은 {@link RecurrenceExpander}(KST 벽시계 기준)를 쓴다.
 *
 * <p>WP-1315: 「한 번만」 예약 — {@code FREQ=ONCE;DATE=yyyy-MM-dd}. 정한 날짜·시각(KST)에 한 번 실행하고 일정이 꺼진다. RFC
 * 5545 에 없는 이 기능 전용 값이라 캘린더 전개기를 거치지 않고 여기서 계산한다. 날짜를 빼고 저장하면({@code FREQ=ONCE}) 저장 시각 기준 그 시각의 다음
 * 때(아직 안 지났으면 오늘, 지났으면 내일)로 채운다({@link #resolveOnce}).
 *
 * <p>WP-1373: 「몇 시간마다」 — {@code FREQ=HOURLY;INTERVAL=n;BYDAY=MO,...;UNTILTIME=HH:mm}. 고른 요일마다 실행
 * 시각(run_time)부터 n 시간 간격으로, 「까지」(UNTILTIME) 시각 이하인 회차만 돈다. 사람이 없는 실행이 너무 잦지 않게 간격은 {@link
 * #HOURLY_INTERVALS} 만 받는다(최소 1시간). UNTILTIME 은 RFC 5545 에 없는 이 기능 전용 값이라 캘린더 전개기를 거치지 않고 여기서 계산한다.
 */
@Component
@RequiredArgsConstructor
public class IssueRecurrenceRules {

  /** 반복 시각은 한국 벽시계로 정한다. */
  public static final ZoneId KST = ZoneId.of("Asia/Seoul");

  /** 실행 시각 "HH:mm"(24시간, 분 단위). */
  private static final Pattern TIME = Pattern.compile("^([01]\\d|2[0-3]):[0-5]\\d$");

  /** 「한 번만」 규칙 모양(WP-1315) — 회차마다 판정하므로 미리 컴파일해 둔다. 대소문자는 가리지 않는다. */
  private static final Pattern ONCE_RULE =
      Pattern.compile("^FREQ=ONCE(;.*)?$", Pattern.CASE_INSENSITIVE);

  private static final DateTimeFormatter HH_MM = DateTimeFormatter.ofPattern("HH:mm");

  /** 「한 번만」 예약의 빈도 값(WP-1315). */
  public static final String ONCE = "ONCE";

  /** 「한 번만」 예약을 이만큼 뒤까지만 받는다 — 잊힌 먼 예약이 남지 않게(1년). */
  static final int ONCE_MAX_DAYS_AHEAD = 366;

  /** 「몇 시간마다」의 빈도 값(WP-1373). */
  public static final String HOURLY = "HOURLY";

  /** 「몇 시간마다」에 고를 수 있는 간격(시간) — 화면의 간격 칩과 같다. 하루를 고르게 나누는 값만 둔다. */
  static final Set<Integer> HOURLY_INTERVALS = Set.of(1, 2, 3, 4, 6, 12);

  /** 「몇 시간마다」 규칙의 머리(WP-1373) — {@link #isHourly} 가 회차마다 앞부분만 대소문자 무시로 비교한다. */
  private static final String HOURLY_HEAD = "FREQ=" + HOURLY;

  /** 「몇 시간마다」 간격 값 모양(한두 자리 숫자) — 저장 때마다 쓰므로 미리 컴파일해 둔다. */
  private static final Pattern INTERVAL_DIGITS = Pattern.compile("\\d{1,2}");

  /** 목록 값 안의 공백(「MO, WE」) — 걷어 내 한 가지 모양으로 저장한다. */
  private static final Pattern WHITESPACE = Pattern.compile("\\s+");

  /** 요일 코드 → 요일. 요일 코드 검사({@link #WEEKDAYS})와 「몇 시간마다」 다음 회차 계산이 같이 쓴다(요일 목록은 여기 한 곳). */
  private static final Map<String, DayOfWeek> DAY_OF_WEEK =
      Map.of(
          "MO", DayOfWeek.MONDAY,
          "TU", DayOfWeek.TUESDAY,
          "WE", DayOfWeek.WEDNESDAY,
          "TH", DayOfWeek.THURSDAY,
          "FR", DayOfWeek.FRIDAY,
          "SA", DayOfWeek.SATURDAY,
          "SU", DayOfWeek.SUNDAY);

  private static final Set<String> FREQS = Set.of("DAILY", "WEEKLY", "MONTHLY", ONCE, HOURLY);
  private static final Set<String> KEYS =
      Set.of("FREQ", "INTERVAL", "BYDAY", "BYMONTHDAY", "DATE", "UNTILTIME");
  private static final Set<String> WEEKDAYS = DAY_OF_WEEK.keySet();

  private final RecurrenceExpander expander;

  /**
   * 반복 규칙을 검증하고 저장할 값(앞뒤 공백 제거·대문자)을 돌려준다. 허용: FREQ=DAILY, FREQ=WEEKLY;BYDAY=MO,WE,
   * FREQ=MONTHLY;BYMONTHDAY=15(쉼표 목록 허용), FREQ=ONCE[;DATE=yyyy-MM-dd](WP-1315),
   * FREQ=HOURLY;INTERVAL=n;BYDAY=..;UNTILTIME=HH:mm(WP-1373). 그 밖의 키·빈도, 「몇 시간마다」 밖의 INTERVAL≠1 은
   * 400. 「까지」 시각이 실행 시각보다 뒤인지는 시각을 함께 보는 {@link #checkHourlyWindow} 가 본다 — 저장은 둘을 함께 부르는 {@link
   * #normalizeForSave} 를 쓴다.
   */
  public String normalizeRrule(String raw) {
    if (raw == null || raw.isBlank()) throw invalid("반복 규칙을 입력해 주세요");
    String rule = raw.strip().toUpperCase(Locale.ROOT);
    if (rule.length() > 200) throw invalid("반복 규칙이 너무 깁니다");
    Map<String, String> parts = new LinkedHashMap<>();
    for (String part : rule.split(";")) {
      int eq = part.indexOf('=');
      if (eq <= 0 || eq == part.length() - 1) throw invalid("반복 규칙 형식이 올바르지 않습니다");
      String key = part.substring(0, eq).strip();
      if (!KEYS.contains(key)) throw invalid("반복 규칙에 쓸 수 없는 항목입니다: " + key);
      if (parts.put(key, part.substring(eq + 1).strip()) != null) {
        throw invalid("반복 규칙에 같은 항목이 두 번 있습니다: " + key);
      }
    }
    String freq = parts.get("FREQ");
    if (freq == null || !FREQS.contains(freq)) {
      throw invalid("실행 일정은 한 번만·매일·매주·매월·몇 시간마다만 쓸 수 있습니다");
    }
    if (ONCE.equals(freq)) return normalizeOnce(parts);
    if (HOURLY.equals(freq)) return normalizeHourly(parts);
    if (parts.containsKey("DATE")) throw invalid("날짜(DATE)는 한 번만 실행에서만 쓸 수 있습니다");
    if (parts.containsKey("UNTILTIME")) {
      throw invalid("끝 시각(UNTILTIME)은 몇 시간마다 실행에서만 쓸 수 있습니다");
    }
    // 하루 1회가 가장 짧은 주기 — 간격을 늘리는 규칙도 화면이 만들지 않으므로 1 만 받는다.
    if (parts.containsKey("INTERVAL") && !"1".equals(parts.get("INTERVAL"))) {
      throw invalid("반복 간격은 1 만 쓸 수 있습니다");
    }
    checkByDay(freq, parts.get("BYDAY"));
    checkByMonthDay(freq, parts.get("BYMONTHDAY"));
    // 항목·목록 값 사이의 공백을 걷어 낸 한 가지 모양으로 저장한다(「MO, WE」 → 「MO,WE」).
    String canonical =
        parts.entrySet().stream()
            .map(e -> e.getKey() + "=" + e.getValue().replaceAll("\\s+", ""))
            .collect(Collectors.joining(";"));
    // 위 검사를 통과한 규칙도 전개기가 실제로 읽을 수 있는지 한 번 더 본다(같은 파서 — 읽지 못하면 400).
    try {
      expander.validate(canonical);
    } catch (IllegalArgumentException e) {
      throw invalid("반복 규칙 형식이 올바르지 않습니다");
    }
    return canonical;
  }

  /**
   * 「한 번만」 규칙(WP-1315) — 요일·날짜·간격은 쓰지 않고, 날짜(DATE=yyyy-MM-dd)는 고를 수 있다(없으면 저장 때 정한다). 저장 모양은 {@code
   * FREQ=ONCE} 또는 {@code FREQ=ONCE;DATE=2026-11-03}.
   */
  private static String normalizeOnce(Map<String, String> parts) {
    if (parts.containsKey("INTERVAL")
        || parts.containsKey("BYDAY")
        || parts.containsKey("BYMONTHDAY")) {
      throw invalid("한 번만 실행에는 요일·날짜 반복·간격을 쓸 수 없습니다");
    }
    String date = parts.get("DATE");
    if (date == null) return "FREQ=" + ONCE;
    return "FREQ=" + ONCE + ";DATE=" + parseDate(date.strip());
  }

  /**
   * 「몇 시간마다」 규칙(WP-1373) — 간격(INTERVAL, 없으면 1)은 {@link #HOURLY_INTERVALS} 중 하나, 요일(BYDAY)은 하나 이상, 끝
   * 시각(UNTILTIME=HH:mm)은 꼭 있어야 한다. 매월 날짜·한 번만 날짜는 쓸 수 없다. 저장 모양은 항목 순서를 고정한 {@code
   * FREQ=HOURLY;INTERVAL=2;BYDAY=MO,TU,WE,TH,FR;UNTILTIME=18:00} 이다(같은 일정이 늘 같은 문자열이 되게).
   */
  private static String normalizeHourly(Map<String, String> parts) {
    if (parts.containsKey("BYMONTHDAY") || parts.containsKey("DATE")) {
      throw invalid("몇 시간마다 실행에는 매월 날짜·한 번만 날짜를 쓸 수 없습니다");
    }
    String rawInterval = parts.getOrDefault("INTERVAL", "1");
    if (!INTERVAL_DIGITS.matcher(rawInterval).matches()
        || !HOURLY_INTERVALS.contains(Integer.parseInt(rawInterval))) {
      throw invalid("간격은 1·2·3·4·6·12시간 중에서 골라야 합니다");
    }
    String byDay = parts.get("BYDAY");
    if (byDay == null) throw invalid("몇 시간마다 실행은 요일을 하나 이상 골라야 합니다");
    String picked = WHITESPACE.matcher(byDay).replaceAll("");
    checkWeekdays(picked);
    // 요일은 고른 순서와 무관하게 월→일 순서로 저장한다 — 같은 일정이 늘 같은 문자열이 되게(겹치는 요일은 위 검사가 400 으로 거절했다).
    String days =
        Stream.of(picked.split(","))
            .sorted(Comparator.comparing(DAY_OF_WEEK::get))
            .collect(Collectors.joining(","));
    String until = parts.get("UNTILTIME");
    if (until == null) throw invalid("몇 시간마다 실행은 끝 시각(까지)을 정해야 합니다");
    if (!TIME.matcher(until).matches()) {
      throw invalid("끝 시각은 HH:mm 형식(예: 18:00)이어야 합니다");
    }
    return "FREQ="
        + HOURLY
        + ";INTERVAL="
        + Integer.parseInt(rawInterval)
        + ";BYDAY="
        + days
        + ";UNTILTIME="
        + until;
  }

  /**
   * 「몇 시간마다」 규칙인지(WP-1373). 규칙을 읽을 수 없으면 false. 회차마다 부르므로 정규식 없이 머리({@code FREQ=HOURLY}, 대소문자 무시)
   * 뒤가 끝이거나 {@code ;} 인지만 본다.
   */
  public static boolean isHourly(String rrule) {
    int n = HOURLY_HEAD.length();
    return rrule != null
        && rrule.regionMatches(true, 0, HOURLY_HEAD, 0, n)
        && (rrule.length() == n || rrule.charAt(n) == ';');
  }

  /**
   * 저장할 규칙을 정한다 — 형식 검증·정규화({@link #normalizeRrule}), 「한 번만」 날짜 채우기({@link #resolveOnce}), 「몇 시간마다」
   * 시간대 검사({@link #checkHourlyWindow})를 이 순서로 한 번에 한다. 시각이 필요한 검사를 저장하는 쪽이 빠뜨리지 않게 한 입구로 묶었다.
   */
  public String normalizeForSave(String raw, LocalTime runTime, Instant now) {
    String rrule = resolveOnce(normalizeRrule(raw), runTime, now);
    checkHourlyWindow(rrule, runTime);
    return rrule;
  }

  /**
   * 「몇 시간마다」의 시간대 검사(WP-1373) — 끝 시각(까지)이 시작 시각(실행 시각)보다 뒤여야 한다. 자정을 넘는 시간대(끝 ≤ 시작)는 받지 않는다(400).
   * 「몇 시간마다」가 아니면 아무것도 하지 않는다. 시각은 규칙과 따로 오므로 {@link #normalizeRrule} 뒤에 부른다({@link
   * #normalizeForSave} 가 부른다).
   */
  void checkHourlyWindow(String rrule, LocalTime runTime) {
    if (!isHourly(rrule)) return;
    LocalTime until = LocalTime.parse(part(rrule, "UNTILTIME"), HH_MM);
    if (!until.isAfter(runTime)) {
      throw invalid("끝 시각(까지)은 시작 시각보다 뒤여야 합니다 — 자정을 넘는 시간대는 쓸 수 없습니다");
    }
  }

  /** 저장된(정규화된) 규칙을 항목 → 값으로 나눈다. 「=」 가 없는 조각은 건너뛴다. */
  private static Map<String, String> splitParts(String rrule) {
    Map<String, String> parts = new LinkedHashMap<>();
    for (String p : rrule.split(";")) {
      int eq = p.indexOf('=');
      if (eq > 0) parts.putIfAbsent(p.substring(0, eq), p.substring(eq + 1));
    }
    return parts;
  }

  /** 규칙에서 한 항목의 값. 없으면 null. 저장된(정규화된) 규칙을 읽을 때 쓴다. */
  private static String part(String rrule, String key) {
    return splitParts(rrule).get(key);
  }

  /**
   * 「몇 시간마다」(WP-1373)의 after 이후(after 제외) 첫 회차 — 고른 요일의 KST 날짜마다 시작 시각, 시작+간격, … 중 끝 시각 이하인 회차를 차례로
   * 본다(끝 시각 정각도 회차다). 그날 남은 회차가 없으면 다음 고른 요일의 시작 시각이다. 규칙을 읽을 수 없으면 null.
   */
  private static Instant nextHourlyRunAfter(String rrule, LocalTime runTime, Instant after) {
    // 저장된 행이 깨져 있어도 스케줄러가 멈추지 않게, 읽을 수 없는 규칙은 예외 대신 null(다음 회차 없음)로 돌린다.
    try {
      // 규칙은 한 번만 나눠 항목을 꺼낸다.
      Map<String, String> parts = splitParts(rrule);
      int interval = Integer.parseInt(parts.get("INTERVAL"));
      LocalTime until = LocalTime.parse(parts.get("UNTILTIME"), HH_MM);
      Set<DayOfWeek> days = EnumSet.noneOf(DayOfWeek.class);
      for (String code : parts.get("BYDAY").split(",")) {
        DayOfWeek d = DAY_OF_WEEK.get(code);
        if (d == null) return null;
        days.add(d);
      }
      if (interval < 1 || days.isEmpty()) return null;
      int startMin = runTime.toSecondOfDay() / 60;
      int untilMin = until.toSecondOfDay() / 60;
      LocalDate today = after.atZone(KST).toLocalDate();
      // 오늘부터 8일 — 고른 요일이 하나뿐이어도 다음 주 같은 요일까지 들어온다.
      for (int i = 0; i <= 7; i++) {
        LocalDate date = today.plusDays(i);
        if (!days.contains(date.getDayOfWeek())) continue;
        for (int m = startMin; m <= untilMin; m += interval * 60) {
          Instant at = date.atStartOfDay(KST).plusMinutes(m).toInstant();
          if (at.isAfter(after)) return at;
        }
      }
      return null;
    } catch (RuntimeException e) {
      return null;
    }
  }

  /** 「한 번만」 날짜 yyyy-MM-dd 를 읽는다 — 형식이 다르거나 없는 날짜(2월 30일 등)면 400. */
  private static LocalDate parseDate(String raw) {
    try {
      return LocalDate.parse(raw);
    } catch (DateTimeParseException e) {
      throw invalid("한 번만 실행 날짜는 yyyy-MM-dd 형식(예: 2026-11-03)이어야 합니다");
    }
  }

  /** 「한 번만」 예약 규칙인지(WP-1315). 규칙을 읽을 수 없으면 false. */
  public static boolean isOnce(String rrule) {
    return rrule != null && ONCE_RULE.matcher(rrule).matches();
  }

  /** 「한 번만」 규칙의 날짜. 없거나 읽을 수 없으면 null. */
  static LocalDate onceDate(String rrule) {
    String date = part(rrule, "DATE");
    if (date == null) return null;
    try {
      return LocalDate.parse(date);
    } catch (DateTimeParseException e) {
      return null;
    }
  }

  /**
   * 저장할 「한 번만」 규칙의 날짜를 정한다(WP-1315) — 날짜가 없으면 그 시각의 다음 때(KST 오늘 그 시각이 now 뒤면 오늘, 아니면 내일)로 채우고, 있으면
   * 그 날짜·시각이 now 뒤인지(지난 시각은 400) 1년 안인지 본다. 「한 번만」이 아니면 그대로 돌려준다.
   */
  public String resolveOnce(String rrule, LocalTime runTime, Instant now) {
    if (!isOnce(rrule)) return rrule;
    LocalDate date = onceDate(rrule);
    LocalDate today = now.atZone(KST).toLocalDate();
    if (date == null) {
      date = today.atTime(runTime).atZone(KST).toInstant().isAfter(now) ? today : today.plusDays(1);
    } else if (!date.atTime(runTime).atZone(KST).toInstant().isAfter(now)) {
      throw invalid("이미 지난 시각입니다 — 지금 이후의 날짜·시각을 골라 주세요");
    } else if (date.isAfter(today.plusDays(ONCE_MAX_DAYS_AHEAD))) {
      throw invalid("한 번만 실행은 1년 안의 날짜만 고를 수 있습니다");
    }
    return "FREQ=" + ONCE + ";DATE=" + date;
  }

  /** 매주 반복은 요일(MO~SU, 중복 없음)이 있어야 하고, 요일은 매주 반복에서만 쓴다. */
  private static void checkByDay(String freq, String byDay) {
    boolean weekly = "WEEKLY".equals(freq);
    if (byDay == null) {
      if (weekly) throw invalid("매주 반복은 요일을 하나 이상 골라야 합니다");
      return;
    }
    if (!weekly) throw invalid("요일(BYDAY)은 매주·몇 시간마다 반복에서만 쓸 수 있습니다");
    checkWeekdays(byDay);
  }

  /** 요일 목록(쉼표)이 MO~SU 중에서 겹치지 않는지 — 매주·몇 시간마다(WP-1373)가 같이 쓴다. */
  private static void checkWeekdays(String byDay) {
    List<String> days = List.of(byDay.split(",", -1));
    if (days.stream().anyMatch(d -> !WEEKDAYS.contains(d.strip()))
        || days.stream().map(String::strip).distinct().count() != days.size()) {
      throw invalid("요일은 MO·TU·WE·TH·FR·SA·SU 중에서 겹치지 않게 골라야 합니다");
    }
  }

  /** 매월 반복은 날짜(1~31, 중복 없음)가 있어야 하고, 날짜는 매월 반복에서만 쓴다. */
  private static void checkByMonthDay(String freq, String byMonthDay) {
    boolean monthly = "MONTHLY".equals(freq);
    if (byMonthDay == null) {
      if (monthly) throw invalid("매월 반복은 날짜(1~31)를 골라야 합니다");
      return;
    }
    if (!monthly) throw invalid("날짜(BYMONTHDAY)는 매월 반복에서만 쓸 수 있습니다");
    List<String> days = List.of(byMonthDay.split(",", -1));
    boolean ok =
        days.stream().map(String::strip).distinct().count() == days.size()
            && days.stream().allMatch(IssueRecurrenceRules::dayOfMonth);
    if (!ok) throw invalid("매월 반복 날짜는 1~31 사이에서 겹치지 않게 골라야 합니다");
  }

  private static boolean dayOfMonth(String v) {
    String s = v.strip();
    if (!s.matches("\\d{1,2}")) return false;
    int n = Integer.parseInt(s);
    return n >= 1 && n <= 31;
  }

  /** 실행 시각 "HH:mm" 을 읽는다. 형식이 다르면 400. */
  public LocalTime parseTime(String raw) {
    if (raw == null || !TIME.matcher(raw.strip()).matches()) {
      throw invalid("실행 시각은 HH:mm 형식(예: 08:30)이어야 합니다");
    }
    return LocalTime.parse(raw.strip(), HH_MM);
  }

  /** 시각을 응답용 "HH:mm" 으로. */
  public static String formatTime(LocalTime t) {
    return t == null ? null : t.format(HH_MM);
  }

  /**
   * after 이후(after 제외)의 첫 회차 시각. 서버가 멈췄다 켜져도 지금 이후의 회차만 보므로 밀린 회차를 몰아서 돌리지 않는다. 간격이 늘 1 이라 회차 집합은
   * 기준일과 무관하므로, 기준(masterStart)은 after 의 KST 전날 실행 시각으로 둔다 — 늘 after 보다 앞서 기준일 자체가 회차로 끼어드는 일이 없다.
   * 2년 안에 회차가 없으면(이론상 없음) null.
   */
  public Instant nextRunAfter(String rrule, LocalTime runTime, Instant after) {
    // 「한 번만」(WP-1315)은 정한 날짜·시각 하나뿐 — after 뒤면 그 시각, 이미 지났으면(실행했거나 놓침) 다음 회차가 없다.
    if (isOnce(rrule)) {
      LocalDate date = onceDate(rrule);
      if (date == null) return null;
      Instant at = date.atTime(runTime).atZone(KST).toInstant();
      return at.isAfter(after) ? at : null;
    }
    // 「몇 시간마다」(WP-1373)는 끝 시각(UNTILTIME)이 캘린더 전개기가 모르는 값이라 여기서 센다.
    if (isHourly(rrule)) return nextHourlyRunAfter(rrule, runTime, after);
    OffsetDateTime masterStart =
        after.atZone(KST).toLocalDate().minusDays(1).atTime(runTime).atZone(KST).toOffsetDateTime();
    return expander
        .nextOccurrenceAfter(rrule, masterStart, after.atOffset(ZoneOffset.UTC), Set.of())
        .map(OffsetDateTime::toInstant)
        .orElse(null);
  }

  private static InvalidIssueRecurrenceException invalid(String message) {
    return new InvalidIssueRecurrenceException(message);
  }
}
