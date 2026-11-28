package com.workplace.calendar.repository;

import static com.workplace.jooq.Tables.CALENDAR_USER_SETTING;

import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
import org.jooq.impl.DSL;
import org.springframework.stereotype.Repository;

/**
 * 캘린더 사용자 설정(WP-2169) 저장소 — 테넌트·사용자당 한 행({@code calendar_user_setting}). 테넌트는 RLS GUC 와 tenant_id
 * 기본값이 정하므로 여기서는 user_id 로만 거른다(메일 사용자 설정 저장소와 같은 방식).
 */
@Repository
@RequiredArgsConstructor
public class CalendarUserSettingRepository {

  private final DSLContext dsl;

  /**
   * 새 일정 기본 캘린더로 지정한 캘린더 id. 행이 없거나, 지정한 캘린더가 지워져 FK 가 NULL 로 바꿨으면 empty — 호출자는 Works 캘린더로 폴백한다.
   */
  public Optional<Long> findPreferredCalendarId(long userId) {
    return dsl.select(CALENDAR_USER_SETTING.PREFERRED_CALENDAR_ID)
        .from(CALENDAR_USER_SETTING)
        .where(CALENDAR_USER_SETTING.USER_ID.eq(userId))
        .fetchOptional()
        .map(r -> r.get(CALENDAR_USER_SETTING.PREFERRED_CALENDAR_ID));
  }

  /** 기본 캘린더 지정을 넣거나 덮어쓴다(테넌트·사용자당 한 행). 덮어쓸 때 updated_at 은 지금으로 바꾼다. */
  public void upsertPreferred(long userId, long calendarId) {
    dsl.insertInto(CALENDAR_USER_SETTING)
        .set(CALENDAR_USER_SETTING.USER_ID, userId)
        .set(CALENDAR_USER_SETTING.PREFERRED_CALENDAR_ID, calendarId)
        .onConflict(CALENDAR_USER_SETTING.TENANT_ID, CALENDAR_USER_SETTING.USER_ID)
        .doUpdate()
        .set(CALENDAR_USER_SETTING.PREFERRED_CALENDAR_ID, calendarId)
        .set(CALENDAR_USER_SETTING.UPDATED_AT, DSL.currentOffsetDateTime())
        .execute();
  }

  /** Outlook 기본 캘린더 질문을 이미 했는지(WP-2171). 행이 없거나 시각이 비었으면 false. */
  public boolean isOutlookPrompted(long userId) {
    return dsl.fetchExists(
        dsl.selectOne()
            .from(CALENDAR_USER_SETTING)
            .where(CALENDAR_USER_SETTING.USER_ID.eq(userId))
            .and(CALENDAR_USER_SETTING.OUTLOOK_PROMPTED_AT.isNotNull()));
  }

  /**
   * 질문을 했다고 기록한다(WP-2171). 행이 없으면 preferred 를 NULL 로 만들고, 있으면 기존 지정은 그대로 둔다. 멱등 — 이미 기록돼 있으면 갱신 자체를
   * 건너뛰어(WHERE) 첫 기록 시각과 updated_at 을 그대로 둔다.
   */
  public void markOutlookPrompted(long userId) {
    dsl.insertInto(CALENDAR_USER_SETTING)
        .set(CALENDAR_USER_SETTING.USER_ID, userId)
        .set(CALENDAR_USER_SETTING.OUTLOOK_PROMPTED_AT, DSL.currentOffsetDateTime())
        .onConflict(CALENDAR_USER_SETTING.TENANT_ID, CALENDAR_USER_SETTING.USER_ID)
        .doUpdate()
        .set(CALENDAR_USER_SETTING.OUTLOOK_PROMPTED_AT, DSL.currentOffsetDateTime())
        .set(CALENDAR_USER_SETTING.UPDATED_AT, DSL.currentOffsetDateTime())
        .where(CALENDAR_USER_SETTING.OUTLOOK_PROMPTED_AT.isNull())
        .execute();
  }
}
