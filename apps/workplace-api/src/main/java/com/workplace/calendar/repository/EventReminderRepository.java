package com.workplace.calendar.repository;

import static com.workplace.jooq.Tables.CALENDAR_EVENT;
import static com.workplace.jooq.Tables.EVENT_REMINDER;

import java.time.OffsetDateTime;
import java.util.Collection;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
import org.jooq.impl.DSL;
import org.springframework.stereotype.Repository;

/** event_reminder jOOQ 접근. 이벤트당 리마인더 1건(UNIQUE event_id). 권한은 calendar service 가 보장. */
@Repository
@RequiredArgsConstructor
public class EventReminderRepository {
  private final DSLContext dsl;

  /** 발화 대기 중인 리마인더 1건 — 폴링 결과. */
  public record DueReminder(long reminderId, long eventId, long ownerId) {}

  /**
   * 리마인더 설정(없으면 생성, 있으면 교체). 리드타임이 실제로 바뀐 경우에만 fired_at 을 null 로 재무장한다 — 일정의 다른 필드만 수정해도 재무장하면 이미
   * 발화한 리마인더가 다시 울려 "중복 발화 방지"에 어긋나기 때문. (일정 시각 이동에 따른 재발화는 v1 비목표)
   */
  public void upsert(long eventId, int leadMinutes) {
    dsl.insertInto(EVENT_REMINDER)
        .set(EVENT_REMINDER.EVENT_ID, eventId)
        .set(EVENT_REMINDER.LEAD_MINUTES, leadMinutes)
        .onConflict(EVENT_REMINDER.EVENT_ID)
        .doUpdate()
        .set(EVENT_REMINDER.LEAD_MINUTES, leadMinutes)
        // 기존 lead_minutes(테이블 참조 = 갱신 전 값) 와 다를 때만 재무장.
        .set(
            EVENT_REMINDER.FIRED_AT,
            DSL.when(
                    EVENT_REMINDER.LEAD_MINUTES.ne(leadMinutes),
                    DSL.castNull(EVENT_REMINDER.FIRED_AT.getDataType()))
                .otherwise(EVENT_REMINDER.FIRED_AT))
        .execute();
  }

  /** 리마인더 제거(설정 해제). */
  public void deleteByEvent(long eventId) {
    dsl.deleteFrom(EVENT_REMINDER).where(EVENT_REMINDER.EVENT_ID.eq(eventId)).execute();
  }

  /**
   * 발화 시점(starts_at - lead_minutes) 이 지난 미발화 리마인더 — 일정 소유자와 함께 반환. now() 기준 due 판정은 DB 시계로 일관되게 한다.
   */
  public List<DueReminder> findDue() {
    return dsl.select(EVENT_REMINDER.ID, CALENDAR_EVENT.ID, CALENDAR_EVENT.OWNER_ID)
        .from(EVENT_REMINDER)
        .join(CALENDAR_EVENT)
        .on(CALENDAR_EVENT.ID.eq(EVENT_REMINDER.EVENT_ID))
        .where(EVENT_REMINDER.FIRED_AT.isNull())
        .and(
            DSL.condition(
                "{0} - make_interval(mins => {1}) <= now()",
                CALENDAR_EVENT.STARTS_AT, EVENT_REMINDER.LEAD_MINUTES))
        .fetch(
            r ->
                new DueReminder(
                    r.get(EVENT_REMINDER.ID),
                    r.get(CALENDAR_EVENT.ID),
                    r.get(CALENDAR_EVENT.OWNER_ID)));
  }

  /** 발화 완료 표시 — 중복 발화 방지. */
  public void markFired(Collection<Long> reminderIds) {
    if (reminderIds.isEmpty()) return;
    dsl.update(EVENT_REMINDER)
        .set(EVENT_REMINDER.FIRED_AT, OffsetDateTime.now())
        .where(EVENT_REMINDER.ID.in(reminderIds))
        .execute();
  }
}
