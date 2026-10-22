package com.workplace.calendar.service;

import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.EnumSet;
import java.util.List;
import java.util.Locale;
import java.util.Optional;
import java.util.Set;
import java.util.TimeZone;
import java.util.function.Predicate;
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
   * 회차를 펼치는 벽시계 시간대(WP-534). 일정에는 시간대가 따로 저장되지 않고 사용자가 보는 날짜가 한국 날짜라(이슈 날짜 필터 WP-307·AI 메모리 기한
   * WP-380 과 같은 기준) Asia/Seoul 로 펼친다. UTC 로 펼치면 09시 이전 시작(종일 포함)의 날짜·요일이 하루 앞당겨져 매월 1일 반복이 「전달 말일」
   * 기준이 되어 31일이 없는 달 다음 달이 빠지고, BYDAY 요일도 어긋난다.
   */
  private static final TimeZone EXPANSION_ZONE = TimeZone.getTimeZone("Asia/Seoul");

  /** RFC5545 UNTIL 의 UTC 절대 시각 포맷(yyyyMMdd'T'HHmmss'Z'). */
  private static final DateTimeFormatter UNTIL_FMT =
      DateTimeFormatter.ofPattern("yyyyMMdd'T'HHmmss'Z'").withZone(ZoneOffset.UTC);

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
    RecurrenceRule rule = parse(rrule);
    if (!SUPPORTED_FREQS.contains(rule.getFreq())) {
      throw new IllegalArgumentException("반복은 매일·매주·매월·매년만 지원합니다");
    }
    // 관용 파싱은 INTERVAL=0·COUNT=0 을 기본값으로 바꿔 읽어 버리므로 원문 토큰으로 본다(저장되는 것은 원문이다).
    if (!positiveToken(rrule, "INTERVAL")) {
      throw new IllegalArgumentException("반복 간격은 1 이상이어야 합니다");
    }
    Integer interval = intervalOf(rrule);
    if (interval != null && interval > MAX_INTERVAL) {
      throw new IllegalArgumentException("반복 간격은 " + MAX_INTERVAL + " 이하여야 합니다");
    }
    if (!positiveToken(rrule, "COUNT")) {
      throw new IllegalArgumentException("반복 횟수는 1 이상이어야 합니다");
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

  /** RRULE 원문에 name= 토큰이 없거나, 있으면 1 이상의 정수인지. */
  private static boolean positiveToken(String rrule, String name) {
    String prefix = name + "=";
    for (String part : rrule.split(";")) {
      String p = part.trim();
      if (p.toUpperCase(Locale.ROOT).startsWith(prefix)) {
        try {
          return Integer.parseInt(p.substring(prefix.length()).trim()) >= 1;
        } catch (NumberFormatException e) {
          return false;
        }
      }
    }
    return true;
  }

  /**
   * RRULE 파싱 — RFC2445_LAX(관용 파싱)로 일부 비표준 입력도 허용. 잘못된 규칙이면 비검사 예외로 전환(쓰기 검증 400 / list per-master
   * 격리에서 처리).
   */
  private static RecurrenceRule parse(String rrule) {
    try {
      return new RecurrenceRule(rrule, RecurrenceRule.RfcMode.RFC2445_LAX);
    } catch (InvalidRecurrenceRuleException e) {
      throw new IllegalArgumentException("반복 규칙 형식이 올바르지 않습니다", e);
    }
  }
}
