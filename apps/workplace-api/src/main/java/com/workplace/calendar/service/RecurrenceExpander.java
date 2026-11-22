package com.workplace.calendar.service;

import java.math.BigInteger;
import java.time.DateTimeException;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeParseException;
import java.time.format.ResolverStyle;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.EnumSet;
import java.util.List;
import java.util.Locale;
import java.util.Optional;
import java.util.Set;
import java.util.TimeZone;
import java.util.function.Predicate;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Collectors;
import lombok.extern.slf4j.Slf4j;
import org.dmfs.rfc5545.DateTime;
import org.dmfs.rfc5545.recur.Freq;
import org.dmfs.rfc5545.recur.InvalidRecurrenceRuleException;
import org.dmfs.rfc5545.recur.RecurrenceRule;
import org.dmfs.rfc5545.recur.RecurrenceRuleIterator;
import org.springframework.stereotype.Component;

/**
 * RRULE(RFC5545) 회차 전개기. 주어진 (rrule, 마스터 시작, from, to) 에 대해 [from, to) 구간의 회차 시작 시각 목록을 반환한다. 회차의
 * 지속시간(종료 시각) 적용은 호출자(서비스) 책임 — 여기서는 시작 시각만 다룬다. lib-recur 0.17.1 사용.
 */
@Component
@Slf4j
public class RecurrenceExpander {

  /** 무한 규칙(예: FREQ=DAILY, 종료 없음) 폭주 방지 안전 상한 — fastForward 이후 적용. */
  private static final int SAFETY_CAP = 1000;

  /**
   * 받는 반복 간격(INTERVAL)의 상한(WP-760). Outlook 이 고를 수 있는 최댓값과 같다.
   *
   * <p>lib-recur 는 int 최댓값 근처 간격(예: 매일·2147483647)에서 일수 계산이 넘쳐 다음 회차를 찾느라 약 60초를 쓴 뒤 포기한다. 기간 조회가
   * DB 커넥션을 쥔 채 그동안 멈춰, 그런 일정 하나와 조회 10건만으로 풀이 고갈됐다.
   */
  static final int MAX_INTERVAL = 999;

  /**
   * 받는 반복 횟수(COUNT)의 상한(WP-905) — 간격과 같이 Outlook 이 고를 수 있는 최댓값. 상한이 없을 때 21억이 넘는 값은 int 로 읽히지 않아 「1
   * 이상이어야 합니다」로 잘못 거절됐다.
   */
  static final int MAX_COUNT = 999;

  /**
   * 회차를 펼치는 벽시계 시간대(WP-534). 일정에는 시간대가 따로 저장되지 않고 사용자가 보는 날짜가 한국 날짜라(이슈 날짜 필터 WP-307·AI 메모리 기한
   * WP-380 과 같은 기준) Asia/Seoul 로 펼친다. UTC 로 펼치면 09시 이전 시작(종일 포함)의 날짜·요일이 하루 앞당겨져 매월 1일 반복이 「전달 말일」
   * 기준이 되어 31일이 없는 달 다음 달이 빠지고, BYDAY 요일도 어긋난다.
   */
  private static final TimeZone EXPANSION_ZONE = TimeZone.getTimeZone("Asia/Seoul");

  /** RFC5545 UNTIL 의 UTC 절대 시각 모양 — 쓰기(UNTIL_FMT)와 검사(STRICT_UNTIL)가 같은 모양을 쓰게 한곳에 둔다(WP-1590). */
  private static final String UNTIL_PATTERN = "uuuuMMdd'T'HHmmss'Z'";

  /** RFC5545 UNTIL 의 UTC 절대 시각 포맷(yyyyMMdd'T'HHmmss'Z'). */
  private static final DateTimeFormatter UNTIL_FMT =
      DateTimeFormatter.ofPattern(UNTIL_PATTERN).withZone(ZoneOffset.UTC);

  /** RRULE 원문의 UNTIL 토큰 — `(^|;)UNTIL=<값>` 을 찾아 값을 그 자리에 다시 쓴다(WP-1915 반려 1). */
  private static final Pattern UNTIL_PART = Pattern.compile("(?i)(^|;)UNTIL=([^;]+)");

  /**
   * 기존 RRULE 에 UNTIL=<cutoff(UTC)> 를 설정한 새 규칙 반환 — 시리즈 잘라내기(THIS_AND_FOLLOWING)용. UNTIL 과 COUNT 는
   * 상호 배타이므로 기존 UNTIL=/COUNT= 토큰을 모두 제거한 뒤 새 UNTIL 을 덧붙인다. cutoff 는 절대(UTC) 시각으로 포맷한다.
   */
  public static String withUntil(String rrule, OffsetDateTime cutoff) {
    String until = "UNTIL=" + UNTIL_FMT.format(cutoff.toInstant());
    String cleaned =
        Arrays.stream(rrule.split(";"))
            .map(String::trim)
            .filter(p -> !p.isEmpty())
            .filter(
                p -> {
                  String upper = p.toUpperCase(Locale.ROOT);
                  return !upper.startsWith("UNTIL=") && !upper.startsWith("COUNT=");
                })
            .collect(Collectors.joining(";"));
    return cleaned.isEmpty() ? until : cleaned + ";" + until;
  }

  /**
   * RRULE 의 UNTIL 을 이동량만큼 옮긴 새 규칙 — 「전체 일정」 끌어 옮기기(WP-1915 반려 1). UNTIL 을 그대로 두면 앞으로 옮긴 시리즈에서 마지막
   * 회차가 새 범위 밖으로 잘린다(예: UNTIL 12-08 시리즈를 +1일 끌면 12-09 회차가 사라진다). UNTIL 없는 규칙(COUNT·무한)은 그대로다.
   *
   * <p>값은 {@link #checkByValues} 처럼 대문자·트림으로 맞춘 뒤 본다 — 그렇지 않으면 validate 가 받는 소문자·공백 값
   * (`20261231t145959z`)은 이동이 그대로 빠져 마지막 회차가 잘린다(UNTIL 토큰 키는 `(?i)` 라 찾고도 값이 미끄러진다).
   *
   * <p>읽지 못하는 값(13월·25시처럼 shape 은 맞지만 날짜가 아닌 것)은 원문을 그대로 준다 — 여기서 밀어 두면 validate 가 뒤에 와도 잘못된 규칙이
   * 통과하기 때문이다. 두지 않으면 뒤의 validateRecurrence 가 400으로 거절하고, 예외를 밖으로 던지면 전역 핸들러에서 500이 된다(WP-1590).
   * 날짜만(yyyyMMdd) UNTIL 은 validate 가 받지 않는 형식이라 여기서 다루지 않는다.
   */
  public static String shiftUntil(String rrule, Duration delta) {
    if (rrule == null || rrule.isBlank() || delta == null || delta.isZero()) {
      return rrule;
    }
    Matcher m = UNTIL_PART.matcher(rrule);
    if (!m.find()) {
      return rrule;
    }
    String value = m.group(2).trim().toUpperCase(Locale.ROOT);
    if (!UNTIL_SHAPE.matcher(value).matches()) {
      return rrule;
    }
    String moved;
    try {
      // STRICT 로 읽어 13월·25시를 먼저 잡는다 — 통과하면 UTC 절대 시각으로 고쳐 이동량만큼 더한다.
      LocalDateTime local = LocalDateTime.parse(value, STRICT_UNTIL);
      moved = UNTIL_FMT.format(OffsetDateTime.of(local, ZoneOffset.UTC).plus(delta));
    } catch (DateTimeException e) {
      // shape 은 맞지만 실 날짜·시각이 아닌 값 — 원문 그대로 두어 validate 가 400으로 거절하게 한다(WP-1590).
      return rrule;
    }
    return rrule.substring(0, m.start(2)) + moved + rrule.substring(m.end(2));
  }

  /**
   * 「전체 일정」 이동이 요일·날짜 규칙을 이동량만큼 따라가지 못할 때의 거절 문구(WP-1927) — {@link #shiftRule}(후보 생성)과 호출자(후보 둘 다
   * 탈락할 때)가 같은 문구를 써야 확인 카드와 실행의 400 이 어긋나지 않는다.
   */
  public static final String SHIFT_RULE_MESSAGE =
      "이동할 수 없는 반복 규칙입니다 — 요일·날짜 규칙이 이동량을 따르지 못합니다(예: 매월 nth 요일). 이 일정만 옮기거나 규칙을 다시 지정해 주세요";

  /**
   * BYDAY 요일 순서 — 순환 이동의 기준(MO → TU → … → SU → MO). 2글자씩이라 짝수 위치가 곧 문자 인덱스다(요일 인덱스 = 문자 인덱스 / 2).
   */
  private static final String WEEKDAY_ORDER = "MOTUWETHFRSASU";

  /**
   * 이동량으로 옮길 수 없는 위치 파트(WP-1927) — BYSETPOS·BYWEEKNO·BYYEARDAY·BYMONTH 는 상대 위치나 월에 얽혀 있어 날짜 이동량을
   * 그대로 반영할 방법이 없어, 이런 파트와 함께 있을 때는 후보 2 를 만들지 않고 거절한다.
   */
  private static final Set<String> UNSHIFTABLE_POSITIONAL_PARTS =
      Set.of("BYSETPOS", "BYWEEKNO", "BYYEARDAY", "BYMONTH");

  /**
   * 전개 견적 검증 창의 탐색 상한(년) — 유한 규칙(UNTIL·COUNT)의 끝을 찾기에 넉넉한 기간. 무한 규칙은 {@link #SAFETY_CAP} 으로 끊겨 그
   * 마지막 회차가 곧 「끝」이 된다.
   */
  private static final int SHIFT_CHECK_HORIZON_YEARS = 10_000;

  /**
   * 「전체 일정」 이동량만큼 RRULE 의 요일·날짜 파트를 옮긴 규칙 <b>후보</b>(WP-1927) — {@link #shiftUntil} 로 마스터 시작·UNTIL 을
   * 옮긴 뒤, BYDAY 요일은 7일 주기로 순환 이동하고(월요일 +1일 → 화요일) BYMONTHDAY 날짜는 이동량을 더한다(15일 +2일 → 17일).
   *
   * <p>후보는 그대로 쓰지 않는다 — 호출자가 {@link #shiftsBy} 로 (옛 시작, 옛 규칙) 과 (새 시작, 이 후보) 의 전개를 견본 뒤 통과한 쪽을 쓴다.
   * 옮길 수 없는 조건에서는 IllegalArgumentException 을 던진다: nth 요일(BYDAY=1MO — 「이달의 첫 월요일 +1일 ≠ 첫 화요일」), 정수
   * 날짜가 아닌 이동량(요일·날짜를 시간 단위로 못 민다), 그리고 {@link #UNSHIFTABLE_POSITIONAL_PARTS}. 전개가 이동량을 따라가지 못하는
   * 규칙을 조용히 고치면 회차가 어긋나 앞 회차가 사라지고 새 회차가 생기기 때문이다.
   *
   * @param rrule 이동 전 규칙(요청 본문의 원문)
   * @param delta 이동량
   * @param newStart 이동 뒤 마스터 시작 — 후보 <b>생성</b>에는 쓰지 않는다(검증은 호출자의 {@link #shiftsBy} 몫). 호출자가 같은 값으로
   *     견적 검증을 돌릴 수 있게 함께 받는다.
   * @return 이동량을 반영한 규칙 후보(요일·날짜 파트가 없으면 UNTIL 만 옮긴 원문)
   * @throws IllegalArgumentException 이동할 수 없는 반복 규칙일 때 — 메시지는 {@link #SHIFT_RULE_MESSAGE}
   */
  public static String shiftRule(String rrule, Duration delta, OffsetDateTime newStart) {
    // a. 빈 규칙·null·제로 이동은 원문 그대로 — 바꿀 이동이 없다.
    if (rrule == null || rrule.isBlank() || delta == null || delta.isZero()) {
      return rrule;
    }
    // b. UNTIL 을 이동량만큼 옮긴다(WP-1915 반려 1) — 옮기지 않으면 앞으로 끌어도 마지막 회차가 새 범위 밖으로 잘린다.
    String moved = shiftUntil(rrule, delta);
    List<String> parts = new ArrayList<>();
    for (String raw : moved.split(";")) {
      if (!raw.trim().isEmpty()) {
        parts.add(raw.trim());
      }
    }
    int bydayIdx = -1;
    int bymonthdayIdx = -1;
    for (int i = 0; i < parts.size(); i++) {
      String key = partKey(parts.get(i));
      if (key.equals("BYDAY")) {
        bydayIdx = i;
      } else if (key.equals("BYMONTHDAY")) {
        bymonthdayIdx = i;
      }
    }
    // 요일·날짜 파트가 없으면 UNTIL 만 옮긴 규칙이 그 자체로 후보 1 이다 — 전개가 DTSTART 에 묶여 이동량을 그대로 따른다.
    if (bydayIdx < 0 && bymonthdayIdx < 0) {
      return moved;
    }
    // c. 파트를 옮기려면 이동량이 정수 날짜여야 한다 — 3시간 이동은 요일·날짜를 밀 수 없다.
    if (!Duration.ofDays(delta.toDays()).equals(delta)) {
      throw new IllegalArgumentException(SHIFT_RULE_MESSAGE);
    }
    // e-1. 그 밖의 위치 파트는 이동량을 따로 옮길 수 없다 — 후보를 만들지 않고 거절한다.
    for (String part : parts) {
      if (UNSHIFTABLE_POSITIONAL_PARTS.contains(partKey(part))) {
        throw new IllegalArgumentException(SHIFT_RULE_MESSAGE);
      }
    }
    long dayDelta = delta.toDays();
    if (bydayIdx >= 0) {
      parts.set(bydayIdx, "BYDAY=" + shiftByDayValues(partValue(parts.get(bydayIdx)), dayDelta));
    }
    if (bymonthdayIdx >= 0) {
      parts.set(
          bymonthdayIdx,
          "BYMONTHDAY=" + shiftByMonthDayValues(partValue(parts.get(bymonthdayIdx)), dayDelta));
    }
    // d. 후보만 만든다 — 실제로 이동량을 따르는지 검증은 호출자가 shiftsBy 로 한다.
    return String.join(";", parts);
  }

  /**
   * BYDAY 값을 한 개씩 dayDelta 만큼 요일 순환 이동한다(WP-1927) — nth 서수(1MO·-1FR)가 붙으면 이동량으로 옮길 수 없어
   * IllegalArgumentException. 요일이 아닌 값도 넘겨지지 않게 같은 문구로 거절한다.
   */
  private static String shiftByDayValues(String value, long dayDelta) {
    List<String> moved = new ArrayList<>();
    for (String raw : value.split(",")) {
      String day = raw.trim().toUpperCase(Locale.ROOT);
      Matcher m = BYDAY_VALUE.matcher(day);
      // nth 요일은 「이달의 첫 월요일 +1일」이 첫 화요일이 아니다 — 날짜 이동량으로 대응되는 nth 를 찾을 수 없다.
      if (!m.matches() || m.group(1) != null) {
        throw new IllegalArgumentException(SHIFT_RULE_MESSAGE);
      }
      int from = WEEKDAY_ORDER.indexOf(day) / 2; // 요일 인덱스(0=MO … 6=SU)
      int to = (int) Math.floorMod(from + dayDelta, WEEKDAY_ORDER.length() / 2) * 2;
      moved.add(WEEKDAY_ORDER.substring(to, to + 2));
    }
    return String.join(",", moved);
  }

  /**
   * BYMONTHDAY 값을 한 개씩 dayDelta 만큼 더한다(WP-1927) — 결과가 1..31 밖이면(예: 31일 +2일 = 33일) 그 달에 없는 날짜라
   * IllegalArgumentException.
   */
  private static String shiftByMonthDayValues(String value, long dayDelta) {
    List<String> moved = new ArrayList<>();
    for (String raw : value.split(",")) {
      String text = raw.trim();
      if (text.startsWith("+")) {
        text = text.substring(1);
      }
      int day;
      try {
        day = Integer.parseInt(text);
      } catch (NumberFormatException e) {
        throw new IllegalArgumentException(SHIFT_RULE_MESSAGE, e);
      }
      long next = day + dayDelta;
      if (next < 1 || next > 31) {
        throw new IllegalArgumentException(SHIFT_RULE_MESSAGE);
      }
      moved.add(Long.toString(next));
    }
    return String.join(",", moved);
  }

  /** RRULE 파트의 키(= 앞부분) — 대문자로 맞춰 비교한다(원문 키는 소문자일 수 있다). */
  private static String partKey(String part) {
    int eq = part.indexOf('=');
    return (eq < 0 ? part : part.substring(0, eq)).trim().toUpperCase(Locale.ROOT);
  }

  /** RRULE 파트의 값(= 뒷부분) — '=' 가 없으면 빈 문자열. */
  private static String partValue(String part) {
    int eq = part.indexOf('=');
    return eq < 0 ? "" : part.substring(eq + 1);
  }

  /**
   * 두 규칙이 이동량만큼 어긋나지 않는지 <b>전개 견적</b>으로 검증한다(WP-1927) — 「전체 일정」 이동의 규칙 후보 판정. 규칙 문자열을 머리로 바꾸는 것만으로는
   * COUNT·UNTIL·월 길이가 얽혀 못 믿으므로, 실제 전개 목록을 견본다.
   *
   * <p>옛 규칙과 후보 규칙을 <b>같은 창</b> — {@code min(옛 시작, 새 시작)} 에서 하루 앞부터 두 시리즈의 끝 중 늦은 쪽(+1일)까지, 끝 찾기는
   * {@link #SHIFT_CHECK_HORIZON_YEARS} 상한, 전개는 {@link #SAFETY_CAP} 한정 — 에서 펼쳐, 두 목록의 길이가 같고 원소가 전부
   * {@code 새 = 옛 + delta} 일 때만 참을 돌려준다. 창을 같이 쓰므로 무한 규칙은 양쪽이 같은 지점({@link #SAFETY_CAP})에서 잘리고, 유한
   * 규칙도 회차 수가 상한을 넘으면 그 지점까지만 비교한다.
   *
   * @param oldRule 이동 전 규칙
   * @param oldStart 이동 전 마스터 시작
   * @param newRule 이동 후 규칙 후보
   * @param newStart 이동 후 마스터 시작
   * @param delta 이동량
   * @return 전개 목록이 길이·원소 모두 이동량만큼 일치하면 참
   */
  public boolean shiftsBy(
      String oldRule,
      OffsetDateTime oldStart,
      String newRule,
      OffsetDateTime newStart,
      Duration delta) {
    Duration step = delta == null ? Duration.ZERO : delta;
    // 두 규칙이 유효한지 먼저 본다 — 손상된 규칙(범위 밖 UNTIL 등)은 전개 도중 런타임 예외를 내어 500 이 되기 때문이다(WP-1590 원칙).
    // 쓰기 경로의 validateRecurrence 는 후보를 고른 뒤에 오므로, 전개가 먼저 도는 이 자리에서 먼저 걸러야 한다.
    if (oldRule != null && !oldRule.isBlank()) {
      validate(oldRule, oldStart);
    }
    if (newRule != null && !newRule.isBlank()) {
      validate(newRule, newStart);
    }
    // 창 시작 — 두 시작 중 이른 날에서 하루 앞: 어느 쪽 첫 회차도 창 밖으로 빠지지 않는다.
    OffsetDateTime from = (oldStart.isBefore(newStart) ? oldStart : newStart).minusDays(1);
    // 창 끝 후보 — 두 시리즈의 마지막 회차를 같은 창에서 먼저 알아낸다(무한 규칙은 SAFETY_CAP 으로 끊긴 마지막이 곧 끝).
    OffsetDateTime probeTo =
        (oldStart.isAfter(newStart) ? oldStart : newStart).plusYears(SHIFT_CHECK_HORIZON_YEARS);
    OffsetDateTime oldEnd = lastOf(expand(oldRule, oldStart, from, probeTo)).orElse(oldStart);
    OffsetDateTime newEnd = lastOf(expand(newRule, newStart, from, probeTo)).orElse(newStart);
    // 늦은 끝을 창에 담도록 하루 더한다 — expand 는 [from, to) 반개 구간이라 끝 회차가 포함되려면 to 가 그보다 커야 한다.
    OffsetDateTime to = (oldEnd.isAfter(newEnd) ? oldEnd : newEnd).plusDays(1);
    List<OffsetDateTime> oldOcc = expand(oldRule, oldStart, from, to);
    List<OffsetDateTime> newOcc = expand(newRule, newStart, from, to);
    if (oldOcc.size() != newOcc.size()) {
      return false;
    }
    for (int i = 0; i < oldOcc.size(); i++) {
      if (!newOcc.get(i).toInstant().equals(oldOcc.get(i).plus(step).toInstant())) {
        return false;
      }
    }
    return true;
  }

  /** 전개 목록의 마지막 회차 — 창에 회차가 하나도 없으면 empty. */
  private static Optional<OffsetDateTime> lastOf(List<OffsetDateTime> occurrences) {
    return occurrences.isEmpty()
        ? Optional.empty()
        : Optional.of(occurrences.get(occurrences.size() - 1));
  }

  /** RRULE 원문의 COUNT 값 — 없거나 숫자가 아니면 null. 원문 토큰으로 본다(관용 파싱은 잘못된 값을 기본값으로 바꿔 읽는다). */
  public static Integer countOf(String rrule) {
    if (rrule == null) return null;
    for (String part : rrule.split(";")) {
      String p = part.trim();
      if (p.toUpperCase(Locale.ROOT).startsWith("COUNT=")) {
        try {
          return Integer.parseInt(p.substring("COUNT=".length()).trim());
        } catch (NumberFormatException e) {
          return null;
        }
      }
    }
    return null;
  }

  /** RRULE 의 COUNT 를 count 로 바꾼 새 규칙(다른 토큰 순서는 그대로). COUNT 가 없는 규칙엔 쓰지 않는다. */
  public static String withCount(String rrule, int count) {
    return Arrays.stream(rrule.split(";"))
        .map(String::trim)
        .filter(p -> !p.isEmpty())
        .map(p -> p.toUpperCase(Locale.ROOT).startsWith("COUNT=") ? "COUNT=" + count : p)
        .collect(Collectors.joining(";"));
  }

  /**
   * [from, to) 안의 회차 시작 시각(UTC) 목록. fastForward 로 과거 회차를 건너뛴 뒤, to 직전까지 순회한다. from 이 마스터 시작 이전이면
   * 건너뛸 것이 없으므로 fastForward 를 호출하지 않는다(타깃이 첫 인스턴스 이전일 때의 미정의 동작 회피).
   */
  public List<OffsetDateTime> expand(
      String rrule, OffsetDateTime masterStart, OffsetDateTime from, OffsetDateTime to) {
    long startMillis = masterStart.toInstant().toEpochMilli();
    long fromMillis = from.toInstant().toEpochMilli();
    long toMillis = to.toInstant().toEpochMilli();

    // 상한 전에 저장된(또는 밖에서 들어온) 큰 간격 규칙은 전개기에 넘기지 않는다(WP-760). 간격이 999 를 넘으면 매일이어도 다음 회차가 2.7년 뒤
    // 이후라 첫 회차만 둔다 — 전개기에 넘기면 int 끝 근처 값에서 조회 하나가 약 60초 멈춘다.
    Integer interval = intervalOf(rrule);
    if (interval != null && interval > MAX_INTERVAL) {
      log.warn("반복 간격 상한({}) 초과 규칙 — 첫 회차만 전개. rrule={}", MAX_INTERVAL, rrule);
      return startMillis >= fromMillis && startMillis < toMillis
          ? List.of(OffsetDateTime.ofInstant(masterStart.toInstant(), ZoneOffset.UTC))
          : List.of();
    }

    // dtStart 는 한국 시간대가 붙은 절대 시각 — 날짜·요일은 한국 벽시계로 계산하고, UNTIL(UTC 절대 시각)과도 섞어 쓸 수 있다
    // (floating 이 아니므로 floating/absolute 혼합 거부를 피한다).
    DateTime dtStart = new DateTime(EXPANSION_ZONE, startMillis);
    RecurrenceRuleIterator it = parse(rrule).iterator(dtStart);

    // from 이 마스터 시작 이후일 때만 과거 회차를 건너뛴다.
    if (fromMillis > startMillis) {
      it.fastForward(new DateTime(DateTime.UTC, fromMillis));
    }

    List<OffsetDateTime> result = new ArrayList<>();
    int n = 0;
    while (it.hasNext()) {
      long m = it.peekMillis();
      if (m >= toMillis) {
        break;
      }
      it.nextMillis();
      result.add(OffsetDateTime.ofInstant(Instant.ofEpochMilli(m), ZoneOffset.UTC));
      if (++n >= SAFETY_CAP) {
        // 무한/초장기 규칙으로 cap 에 걸려 무음 절단되면 누락이 눈에 안 띄므로 경고 로그를 남긴다.
        log.warn("SAFETY_CAP({}) 도달 — 회차 전개 조기 종료. rrule={}", SAFETY_CAP, rrule);
        break;
      }
    }
    return result;
  }

  /**
   * 규칙 전개가 그 순간(occurrence)을 실제 회차로 내는가(WP-541·WP-1703). 전개는 밀리초 단위라 앞뒤 1초 창에서 같은 순간을 찾는다 — 회차
   * 수정·삭제 검증과 노트 「연결된 일정」 거르기가 같은 판정을 쓰게 한 곳에 둔다.
   */
  public boolean producesOccurrence(String rrule, OffsetDateTime masterStart, Instant occurrence) {
    OffsetDateTime occ = OffsetDateTime.ofInstant(occurrence, ZoneOffset.UTC);
    return expand(rrule, masterStart, occ.minusSeconds(1), occ.plusSeconds(1)).stream()
        .anyMatch(o -> o.toInstant().equals(occurrence));
  }

  /** 리마인더 재무장(#705) 시 "다음 회차"를 찾는 탐색 상한 — 이 안에 미제외 회차가 없으면 시리즈가 사실상 끝난 것으로 본다. */
  private static final int NEXT_OCCURRENCE_SEARCH_HORIZON_YEARS = 2;

  /**
   * after 이후 첫 미제외(취소/오버라이드 아닌) 회차의 시작 시각. 캘린더 리마인더(#705)가 발화/재계산 시 "다음 회차"를 찾는 데 쓴다 — excluded 는
   * {@code calendar_event_exception} 에 기록된 회차(취소든 오버라이드든, 마스터 리마인더의 재무장 대상이 아님)의 Instant 집합이다. 탐색
   * 상한({@link #NEXT_OCCURRENCE_SEARCH_HORIZON_YEARS}) 안에 없으면 UNTIL/COUNT 로 시리즈가 끝났거나(정상) 극단적으로 회차가
   * 희소한 규칙(예외적)이므로 재무장하지 않는다(empty) — 무한정 미래로 탐색을 넓히면 무한/장기 규칙에서 비용이 커진다.
   */
  public Optional<OffsetDateTime> nextOccurrenceAfter(
      String rrule, OffsetDateTime masterStart, OffsetDateTime after, Set<Instant> excluded) {
    OffsetDateTime from = after.plusSeconds(1);
    OffsetDateTime to = from.plusYears(NEXT_OCCURRENCE_SEARCH_HORIZON_YEARS);
    for (OffsetDateTime occ : expand(rrule, masterStart, from, to)) {
      if (!excluded.contains(occ.toInstant())) {
        return Optional.of(occ);
      }
    }
    return Optional.empty();
  }

  /** 쓰기에서 받는 반복 빈도 — 화면이 고르는 매일·매주·매월에 매년을 더한 것(WP-622). */
  private static final Set<Freq> SUPPORTED_FREQS =
      EnumSet.of(Freq.DAILY, Freq.WEEKLY, Freq.MONTHLY, Freq.YEARLY);

  /**
   * RRULE 유효성 검증(쓰기 시점) — 잘못된 규칙이면 IllegalArgumentException(전역 핸들러에서 400).
   *
   * <p>WP-622: 형식만 보면 초·분·시 단위 반복이나 간격 0 도 통과해, 초대받은 사람의 하루 칸에 같은 일정이 전개 상한(1000)까지 쏟아지고 그 뒤 회차는
   * 잘렸다. 빈도는 매일·매주·매월·매년만, 간격·횟수는 1 이상만 받는다. 이미 저장된 규칙의 전개(목록·리마인더)는 그대로 둔다.
   */
  public void validate(String rrule) {
    // UNTIL 은 파싱보다 먼저 본다(WP-1590) — 파서는 범위 밖 값(20261301T000000Z)에 500, 없는 날짜에 빈 메시지 예외를 내고, 읽지 못한
    // 값(nope·빈 값)은 조용히 버려 끝없는 반복으로 저장됐다.
    checkByValues(rrule, "UNTIL", RecurrenceExpander::validUntil, UNTIL_MESSAGE);
    RecurrenceRule rule = parse(rrule);
    if (!SUPPORTED_FREQS.contains(rule.getFreq())) {
      throw new IllegalArgumentException("반복은 매일·매주·매월·매년만 지원합니다");
    }
    // 관용 파싱은 INTERVAL=0·COUNT=0 을 기본값으로 바꿔 읽어 버리므로 원문 토큰으로 본다(저장되는 것은 원문이다).
    if (!positiveToken(rrule, "INTERVAL")) {
      throw new IllegalArgumentException("반복 간격은 1 이상이어야 합니다");
    }
    if (tokenAbove(rrule, "INTERVAL", MAX_INTERVAL)) {
      throw new IllegalArgumentException("반복 간격은 " + MAX_INTERVAL + " 이하여야 합니다");
    }
    if (!positiveToken(rrule, "COUNT")) {
      throw new IllegalArgumentException("반복 횟수는 1 이상이어야 합니다");
    }
    if (tokenAbove(rrule, "COUNT", MAX_COUNT)) {
      throw new IllegalArgumentException("반복 횟수는 " + MAX_COUNT + " 이하여야 합니다");
    }
    // 관용 파싱은 범위 밖 BY 값(BYMONTH=13·BYDAY=XX)을 조용히 버려, 저장된 규칙과 달리 시작일 기준으로 반복됐다(WP-746). 원문 토큰으로 본다.
    checkByValues(rrule, "BYMONTH", v -> inRange(v, 1, 12), "반복 월(BYMONTH)은 1~12 여야 합니다");
    checkByValues(
        rrule,
        "BYMONTHDAY",
        v -> nonZeroWithin(v, 31),
        "반복 날짜(BYMONTHDAY)는 1~31 또는 -1~-31 이어야 합니다");
    checkByValues(
        rrule, "BYSETPOS", v -> nonZeroWithin(v, 366), "반복 순번(BYSETPOS)은 0 이 아닌 -366~366 이어야 합니다");
    // BYDAY 서수는 한 달 안에서 세면(MONTHLY, 또는 BYMONTH 가 있는 YEARLY) ±1~5, 한 해 안에서 세면 ±1~53 이다.
    int maxOrdinal =
        rule.getFreq() == Freq.MONTHLY
                || (rule.getFreq() == Freq.YEARLY
                    && rrule.toUpperCase(Locale.ROOT).contains("BYMONTH="))
            ? 5
            : 53;
    checkByValues(
        rrule,
        "BYDAY",
        v -> validByDay(v, maxOrdinal),
        "반복 요일(BYDAY)은 MO·TU·WE·TH·FR·SA·SU 이어야 합니다(예: MO, 2TU, -1FR)");
  }

  /**
   * 원문 UNTIL 값을 엄격히 읽는 포맷(WP-1590) — STRICT 라 13월·32일·2월 30일·25시를 실제 날짜·시각이 아니라고 거절한다. 부호·5자리 이상
   * 연도는 앞의 {@link #UNTIL_SHAPE} 가 먼저 막는다(uuuu 는 그런 연도도 읽어 버린다).
   */
  private static final DateTimeFormatter STRICT_UNTIL =
      DateTimeFormatter.ofPattern(UNTIL_PATTERN).withResolverStyle(ResolverStyle.STRICT);

  /** UNTIL 값의 글자 모양 — 숫자 8자리·T·숫자 6자리·Z 만(부호·자릿수 다른 연도·날짜만·floating 은 여기서 걸린다). */
  private static final Pattern UNTIL_SHAPE = Pattern.compile("\\d{8}T\\d{6}Z");

  /** UNTIL 형식 오류 문구(같은 패키지 테스트가 참조한다). */
  static final String UNTIL_MESSAGE = "반복 종료일(UNTIL)은 20261231T145959Z 처럼 UTC 날짜·시각이어야 합니다";

  /**
   * UNTIL 값 하나가 UTC 절대 시각(yyyyMMdd'T'HHmmss'Z')으로 실제 날짜·시각으로 읽히는지(WP-1590). {@link #checkByValues}
   * 가 토큰마다 대문자로 맞춰 넘기므로 관용 파서가 읽던 t·z 소문자 값도 받고, 토큰이 둘 이상이어도(파서는 마지막 값을 쓴다) 모두 본다.
   *
   * <p>일정 시작은 늘 오프셋이 있는 절대 시각이라 날짜만·floating UNTIL 은 라이브러리가 어차피 영어 오류로 거절한다 — 웹
   * (kstEndOfDayUntil)·서버 분할(UNTIL_FMT)도 이 형식만 만들므로 이 하나만 받는다. 1900 년 전 같은 이른 값은 형식이 맞으면 여기서 통과하고,
   * {@link #validate(String, OffsetDateTime)} 의 「반복 종료일이 일정 시작보다 이릅니다」가 거절한다.
   */
  private static boolean validUntil(String v) {
    if (!UNTIL_SHAPE.matcher(v).matches()) return false;
    try {
      LocalDateTime.parse(v, STRICT_UNTIL);
      return true;
    } catch (DateTimeParseException e) {
      return false;
    }
  }

  /** BYDAY 한 값 — 요일 앞에 부호 있는 서수를 붙일 수 있다(예: 2TU, -1FR). */
  private static final Pattern BYDAY_VALUE =
      Pattern.compile("([+-]?\\d{1,2})?(MO|TU|WE|TH|FR|SA|SU)");

  /** BYDAY 한 값이 요일이고, 서수가 있으면 0 이 아닌 ±maxOrdinal 안인지. */
  private static boolean validByDay(String v, int maxOrdinal) {
    var m = BYDAY_VALUE.matcher(v);
    if (!m.matches()) return false;
    return m.group(1) == null || nonZeroWithin(m.group(1), maxOrdinal);
  }

  /** RRULE 원문의 name= 토큰이 있으면 쉼표로 나눈 값마다 ok 를 만족하는지 보고, 아니면 message 로 거절한다. */
  private static void checkByValues(
      String rrule, String name, Predicate<String> ok, String message) {
    String prefix = name + "=";
    for (String part : rrule.split(";")) {
      String p = part.trim();
      if (p.toUpperCase(Locale.ROOT).startsWith(prefix)) {
        for (String v : p.substring(prefix.length()).split(",")) {
          if (!ok.test(v.trim().toUpperCase(Locale.ROOT))) {
            throw new IllegalArgumentException(message);
          }
        }
      }
    }
  }

  private static boolean inRange(String v, int min, int max) {
    try {
      int n = Integer.parseInt(v);
      return n >= min && n <= max;
    } catch (NumberFormatException e) {
      return false;
    }
  }

  /** 0 이 아닌 -max~max(앞쪽 + 허용). */
  private static boolean nonZeroWithin(String v, int max) {
    try {
      int n = Integer.parseInt(v.startsWith("+") ? v.substring(1) : v);
      return n != 0 && Math.abs(n) <= max;
    } catch (NumberFormatException e) {
      return false;
    }
  }

  /**
   * {@link #validate(String)} 에 더해 일정 시작과 함께 본다 — UNTIL 이 시작보다 일러 회차가 하나도 없는 규칙을 거절한다(WP-746).
   * UNTIL 이 있을 때만 본다: UNTIL 이 반복을 끝내므로 첫 회차를 찾는 탐색이 끝없이 돌지 않는다.
   */
  public void validate(String rrule, OffsetDateTime start) {
    validate(rrule);
    RecurrenceRule rule = parse(rrule);
    if (rule.getUntil() != null && start != null) {
      DateTime dtStart = new DateTime(EXPANSION_ZONE, start.toInstant().toEpochMilli());
      if (!rule.iterator(dtStart).hasNext()) {
        throw new IllegalArgumentException("반복 종료일이 일정 시작보다 이릅니다");
      }
    }
  }

  /** RRULE 원문의 INTERVAL 값 — 없거나 int 정수가 아니면 null. 원문 토큰으로 본다(관용 파싱은 잘못된 값을 기본값으로 바꿔 읽는다). */
  private static Integer intervalOf(String rrule) {
    if (rrule == null) return null;
    for (String part : rrule.split(";")) {
      String p = part.trim();
      if (p.toUpperCase(Locale.ROOT).startsWith("INTERVAL=")) {
        try {
          return Integer.parseInt(p.substring("INTERVAL=".length()).trim());
        } catch (NumberFormatException e) {
          return null;
        }
      }
    }
    return null;
  }

  /** RRULE 원문에 name= 토큰이 없거나, 있으면 1 이상의 정수인지 — int 범위를 넘는 큰 수도 양수로 본다(상한은 tokenAbove 가 본다). */
  private static boolean positiveToken(String rrule, String name) {
    String value = tokenValue(rrule, name);
    if (value == null) return true;
    try {
      return new BigInteger(value).signum() > 0;
    } catch (NumberFormatException e) {
      return false;
    }
  }

  /** RRULE 원문의 name= 값이 max 보다 큰 정수인지 — int 로 읽히지 않는 큰 수도 넘은 것으로 본다(WP-905). */
  private static boolean tokenAbove(String rrule, String name, int max) {
    String value = tokenValue(rrule, name);
    if (value == null) return false;
    try {
      return new BigInteger(value).compareTo(BigInteger.valueOf(max)) > 0;
    } catch (NumberFormatException e) {
      return false;
    }
  }

  /** RRULE 원문에서 name= 토큰의 값(앞뒤 공백 제거) — 없으면 null. */
  private static String tokenValue(String rrule, String name) {
    String prefix = name + "=";
    for (String part : rrule.split(";")) {
      String p = part.trim();
      if (p.toUpperCase(Locale.ROOT).startsWith(prefix)) return p.substring(prefix.length()).trim();
    }
    return null;
  }

  /**
   * RRULE 파싱 — RFC2445_LAX(관용 파싱)로 일부 비표준 입력도 허용. 잘못된 규칙이면 비검사 예외로 전환(쓰기 검증 400 / list per-master
   * 격리에서 처리).
   */
  private static RecurrenceRule parse(String rrule) {
    try {
      return new RecurrenceRule(rrule, RecurrenceRule.RfcMode.RFC2445_LAX);
    } catch (InvalidRecurrenceRuleException | RuntimeException e) {
      // WP-1590: 파서는 검사 예외 말고도 런타임 예외(범위 밖 날짜 등)를 던져 500 이 됐다 — 모두 같은 400 문구로 바꾼다.
      throw new IllegalArgumentException("반복 규칙 형식이 올바르지 않습니다", e);
    }
  }
}
