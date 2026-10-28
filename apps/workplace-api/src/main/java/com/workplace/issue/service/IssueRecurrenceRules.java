package com.workplace.issue.service;

import com.workplace.calendar.service.RecurrenceExpander;
import com.workplace.issue.exception.InvalidIssueRecurrenceException;
import java.time.Instant;
import java.time.LocalTime;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;
import java.util.stream.Collectors;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

/**
 * 이슈 반복(WP-989)의 규칙 검증과 다음 회차 계산. 반복 AI 작업은 사람이 없는 실행이라 가장 짧은 주기를 하루 1회로 묶는다 — 매일·매주(요일)·매월(날짜)만,
 * 간격(INTERVAL)은 1 만 받는다. 회차 전개는 캘린더 반복과 같은 {@link RecurrenceExpander}(KST 벽시계 기준)를 쓴다.
 */
@Component
@RequiredArgsConstructor
public class IssueRecurrenceRules {

  /** 반복 시각은 한국 벽시계로 정한다. */
  public static final ZoneId KST = ZoneId.of("Asia/Seoul");

  /** 실행 시각 "HH:mm"(24시간, 분 단위). */
  private static final Pattern TIME = Pattern.compile("^([01]\\d|2[0-3]):[0-5]\\d$");

  private static final DateTimeFormatter HH_MM = DateTimeFormatter.ofPattern("HH:mm");

  private static final Set<String> FREQS = Set.of("DAILY", "WEEKLY", "MONTHLY");
  private static final Set<String> KEYS = Set.of("FREQ", "INTERVAL", "BYDAY", "BYMONTHDAY");
  private static final Set<String> WEEKDAYS = Set.of("MO", "TU", "WE", "TH", "FR", "SA", "SU");

  private final RecurrenceExpander expander;

  /**
   * 반복 규칙을 검증하고 저장할 값(앞뒤 공백 제거·대문자)을 돌려준다. 허용: FREQ=DAILY, FREQ=WEEKLY;BYDAY=MO,WE,
   * FREQ=MONTHLY;BYMONTHDAY=15(쉼표 목록 허용). 그 밖의 키·빈도·INTERVAL≠1 은 400.
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
    if (freq == null || !FREQS.contains(freq)) throw invalid("반복은 매일·매주·매월만 쓸 수 있습니다");
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

  /** 매주 반복은 요일(MO~SU, 중복 없음)이 있어야 하고, 요일은 매주 반복에서만 쓴다. */
  private static void checkByDay(String freq, String byDay) {
    boolean weekly = "WEEKLY".equals(freq);
    if (byDay == null) {
      if (weekly) throw invalid("매주 반복은 요일을 하나 이상 골라야 합니다");
      return;
    }
    if (!weekly) throw invalid("요일(BYDAY)은 매주 반복에서만 쓸 수 있습니다");
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
