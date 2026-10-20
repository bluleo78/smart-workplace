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

  /**
   * [from, to) 안의 회차 시작 시각(UTC) 목록. fastForward 로 과거 회차를 건너뛴 뒤, to 직전까지 순회한다. from 이 마스터 시작 이전이면
   * 건너뛸 것이 없으므로 fastForward 를 호출하지 않는다(타깃이 첫 인스턴스 이전일 때의 미정의 동작 회피).
   */
  public List<OffsetDateTime> expand(
      String rrule, OffsetDateTime masterStart, OffsetDateTime from, OffsetDateTime to) {
    long startMillis = masterStart.toInstant().toEpochMilli();
    long fromMillis = from.toInstant().toEpochMilli();
    long toMillis = to.toInstant().toEpochMilli();

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
    if (!positiveToken(rrule, "COUNT")) {
      throw new IllegalArgumentException("반복 횟수는 1 이상이어야 합니다");
    }
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
      throw new IllegalArgumentException("반복 규칙 형식이 올바르지 않습니다 (rrule: " + rrule + ")", e);
    }
  }
}
