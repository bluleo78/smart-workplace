package com.workplace.calendar.repository;

import static com.workplace.jooq.Tables.CALENDAR_EVENT;
import static com.workplace.jooq.Tables.EVENT_REMINDER;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
import org.jooq.impl.DSL;
import org.springframework.stereotype.Repository;

/**
 * event_reminder jOOQ 접근. 이벤트당 리마인더 1건(UNIQUE event_id). 권한은 calendar service 가 보장.
 *
 * <p>#705: 발화 판정을 {@code next_fire_at}(다음 발화 예정 시각, cron next_run_at 패턴) 기준으로 단순화했다. 반복 일정은 회차마다 다음
 * 회차 시각으로 재무장해야 하므로(RRULE 전개 필요), 그 계산은 이 레포지토리가 아니라 호출자(CalendarEventService/
 * CalendarReminderScheduler, RecurrenceExpander 보유)가 맡고 여기는 값 저장/조회만 한다. {@code fired_at} 은 더 이상 폴링
 * 판정에 쓰이지 않고 마지막 발화 시각 감사 기록으로만 유지된다.
 */
@Repository
@RequiredArgsConstructor
public class EventReminderRepository {
  private final DSLContext dsl;

  /** 발화 대기 중인 리마인더 1건 — 폴링 결과 + 재무장 계산에 필요한 필드(리드타임/마스터 시작시각/RRULE). */
  public record DueReminder(
      long reminderId,
      long eventId,
      long ownerId,
      OffsetDateTime nextFireAt,
      int leadMinutes,
      OffsetDateTime startsAt,
      String recurrenceRule) {}

  /** 리마인더 현재 상태 — 재설정(applyReminder) 시 "실제로 재계산이 필요한가" 판단용. */
  public record ReminderState(int leadMinutes, OffsetDateTime nextFireAt) {}

  /** 발화 재무장 지시 — reminderId 별 다음 발화 시각(null=더 이상 발화 없음). */
  public record Rearm(long reminderId, OffsetDateTime nextFireAt) {}

  /** 이벤트의 현재 리마인더 상태 조회(없으면 empty) — applyReminder 가 재계산 필요 여부 판단에 사용. */
  public Optional<ReminderState> findByEvent(long eventId) {
    return dsl.select(EVENT_REMINDER.LEAD_MINUTES, EVENT_REMINDER.NEXT_FIRE_AT)
        .from(EVENT_REMINDER)
        .where(EVENT_REMINDER.EVENT_ID.eq(eventId))
        .fetchOptional(
            r ->
                new ReminderState(
                    r.get(EVENT_REMINDER.LEAD_MINUTES), r.get(EVENT_REMINDER.NEXT_FIRE_AT)));
  }

  /**
   * 리마인더 설정(없으면 생성, 있으면 교체) — nextFireAt 은 호출자가 이미 계산해 전달한다(변경 여부 판단도 호출자 책임, #705). 리드타임만 갱신하고
   * 스케줄은 그대로 두고 싶다면 호출자가 기존 nextFireAt 값을 그대로 다시 넘기면 된다.
   */
  public void upsert(long eventId, int leadMinutes, OffsetDateTime nextFireAt) {
    dsl.insertInto(EVENT_REMINDER)
        .set(EVENT_REMINDER.EVENT_ID, eventId)
        .set(EVENT_REMINDER.LEAD_MINUTES, leadMinutes)
        .set(EVENT_REMINDER.NEXT_FIRE_AT, nextFireAt)
        .onConflict(EVENT_REMINDER.EVENT_ID)
        .doUpdate()
        .set(EVENT_REMINDER.LEAD_MINUTES, leadMinutes)
        .set(EVENT_REMINDER.NEXT_FIRE_AT, nextFireAt)
        .execute();
  }

  /** 리마인더 제거(설정 해제). */
  public void deleteByEvent(long eventId) {
    dsl.deleteFrom(EVENT_REMINDER).where(EVENT_REMINDER.EVENT_ID.eq(eventId)).execute();
  }

  /**
   * 발화 시점(next_fire_at) 이 지난 리마인더 — 일정 소유자 + 재무장 계산에 필요한 필드와 함께 반환. now() 기준 due 판정은 DB 시계로 일관되게
   * 한다.
   */
  public List<DueReminder> findDue() {
    return dsl.select(
            EVENT_REMINDER.ID,
            CALENDAR_EVENT.ID,
            CALENDAR_EVENT.OWNER_ID,
            EVENT_REMINDER.NEXT_FIRE_AT,
            EVENT_REMINDER.LEAD_MINUTES,
            CALENDAR_EVENT.STARTS_AT,
            CALENDAR_EVENT.RECURRENCE_RULE)
        .from(EVENT_REMINDER)
        .join(CALENDAR_EVENT)
        .on(CALENDAR_EVENT.ID.eq(EVENT_REMINDER.EVENT_ID))
        .where(EVENT_REMINDER.NEXT_FIRE_AT.isNotNull())
        .and(DSL.condition("{0} <= now()", EVENT_REMINDER.NEXT_FIRE_AT))
        .fetch(
            r ->
                new DueReminder(
                    r.get(EVENT_REMINDER.ID),
                    r.get(CALENDAR_EVENT.ID),
                    r.get(CALENDAR_EVENT.OWNER_ID),
                    r.get(EVENT_REMINDER.NEXT_FIRE_AT),
                    r.get(EVENT_REMINDER.LEAD_MINUTES),
                    r.get(CALENDAR_EVENT.STARTS_AT),
                    r.get(CALENDAR_EVENT.RECURRENCE_RULE)));
  }

  /**
   * 발화 완료 처리(#705) — fired_at 을 감사 기록으로 남기고, 회차별로 계산된 다음 발화 시각으로 재무장한다(null=더 이상 없음: 단발 완료 또는 반복
   * 시리즈 종료). reminderId 별 값이 다르므로 배치로 실행.
   */
  public void rearm(List<Rearm> rearms) {
    if (rearms.isEmpty()) return;
    var queries =
        rearms.stream()
            .map(
                r ->
                    dsl.update(EVENT_REMINDER)
                        .set(EVENT_REMINDER.FIRED_AT, OffsetDateTime.now())
                        .set(EVENT_REMINDER.NEXT_FIRE_AT, r.nextFireAt())
                        .where(EVENT_REMINDER.ID.eq(r.reminderId())))
            .toList();
    dsl.batch(queries).execute();
  }
}
