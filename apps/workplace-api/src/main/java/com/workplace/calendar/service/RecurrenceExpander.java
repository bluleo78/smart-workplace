package com.workplace.calendar.service;

import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import org.dmfs.rfc5545.DateTime;
import org.dmfs.rfc5545.recur.InvalidRecurrenceRuleException;
import org.dmfs.rfc5545.recur.RecurrenceRule;
import org.dmfs.rfc5545.recur.RecurrenceRuleIterator;
import org.springframework.stereotype.Component;

/**
 * RRULE(RFC5545) 회차 전개기. 주어진 (rrule, 마스터 시작, from, to) 에 대해 [from, to) 구간의 회차 시작 시각 목록을 반환한다. 회차의
 * 지속시간(종료 시각) 적용은 호출자(서비스) 책임 — 여기서는 시작 시각만 다룬다. lib-recur 0.17.1 사용.
 */
@Component
public class RecurrenceExpander {

  /** 무한 규칙(예: FREQ=DAILY, 종료 없음) 폭주 방지 안전 상한 — fastForward 이후 적용. */
  private static final int SAFETY_CAP = 1000;

  /**
   * [from, to) 안의 회차 시작 시각(UTC) 목록. fastForward 로 과거 회차를 건너뛴 뒤, to 직전까지 순회한다. from 이 마스터 시작 이전이면
   * 건너뛸 것이 없으므로 fastForward 를 호출하지 않는다(타깃이 첫 인스턴스 이전일 때의 미정의 동작 회피).
   */
  public List<OffsetDateTime> expand(
      String rrule, OffsetDateTime masterStart, OffsetDateTime from, OffsetDateTime to) {
    long startMillis = masterStart.toInstant().toEpochMilli();
    long fromMillis = from.toInstant().toEpochMilli();
    long toMillis = to.toInstant().toEpochMilli();

    // dtStart 와 UNTIL 모두 절대(UTC) 시각이어야 floating/absolute 혼합 거부를 피한다.
    DateTime dtStart = new DateTime(DateTime.UTC, startMillis);
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
        break;
      }
    }
    return result;
  }

  /** RRULE 유효성 검증(쓰기 시점) — 잘못된 규칙이면 IllegalArgumentException(전역 핸들러에서 400). 파싱 성공 여부만 확인한다. */
  public void validate(String rrule) {
    parse(rrule);
  }

  /**
   * RRULE 파싱 — RFC2445_LAX(관용 파싱)로 일부 비표준 입력도 허용. 잘못된 규칙이면 비검사 예외로 전환(쓰기 검증 400 / list per-master
   * 격리에서 처리).
   */
  private static RecurrenceRule parse(String rrule) {
    try {
      return new RecurrenceRule(rrule, RecurrenceRule.RfcMode.RFC2445_LAX);
    } catch (InvalidRecurrenceRuleException e) {
      throw new IllegalArgumentException("invalid recurrence rule: " + rrule, e);
    }
  }
}
