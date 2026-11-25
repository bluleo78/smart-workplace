package com.workplace.wiki.report;

import static com.workplace.jooq.Tables.MEMBERSHIP;
import static com.workplace.jooq.Tables.USER;
import static org.jooq.impl.DSL.field;
import static org.jooq.impl.DSL.name;
import static org.jooq.impl.DSL.table;

import com.workplace.issue.report.PersonalReportKind;
import java.time.LocalTime;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
import org.jooq.Field;
import org.jooq.Record;
import org.jooq.Table;
import org.jooq.impl.DSL;
import org.springframework.stereotype.Repository;

/**
 * 개인 보고 설정(personal_report_setting, V290) 저장소(WP-1486) — 워크스페이스(테넌트)마다 사람당 1행(PK tenant_id,
 * user_id). 행이 없으면 기본값(꺼짐·09:00·건너뜀 켬)으로 본다. 한 사람이 여러 워크스페이스에 속하므로 설정도 워크스페이스마다 따로다.
 *
 * <p>자동 일일 보고의 다음 실행 시각(next_run_at)·실패 재시도 상태도 여기 둔다. 실행기는 {@link #claim} 의 조건부 UPDATE 로 점유해 여러
 * 파드가 같은 사람을 동시에 처리하지 않는다. jOOQ 코드 생성 없이 이름(DSL.name)으로 다룬다. 테넌트 격리는 RLS 와 tenant_id 기본값이 맡는다 — 모든
 * 메서드는 트랜잭션 안에서 불러야 한다.
 */
@Repository
@RequiredArgsConstructor
public class PersonalReportSettingRepository {

  private static final String TBL = "personal_report_setting";
  private static final Table<?> T = table(name(TBL));
  private static final Field<Long> TENANT_ID = field(name(TBL, "tenant_id"), Long.class);
  private static final Field<Long> USER_ID = field(name(TBL, "user_id"), Long.class);
  private static final Field<Boolean> DAILY_ENABLED =
      field(name(TBL, "daily_enabled"), Boolean.class);
  private static final Field<LocalTime> TIME_OF_DAY =
      field(name(TBL, "time_of_day"), LocalTime.class);
  private static final Field<Boolean> SKIP_EMPTY = field(name(TBL, "skip_empty"), Boolean.class);
  private static final Field<Long> DAILY_TEMPLATE =
      field(name(TBL, "daily_template_page_id"), Long.class);
  private static final Field<Long> WEEKLY_TEMPLATE =
      field(name(TBL, "weekly_template_page_id"), Long.class);
  private static final Field<OffsetDateTime> NEXT_RUN_AT =
      field(name(TBL, "next_run_at"), OffsetDateTime.class);
  private static final Field<Integer> FAILURES =
      field(name(TBL, "consecutive_failures"), Integer.class);
  private static final Field<OffsetDateTime> LAST_ATTEMPT_AT =
      field(name(TBL, "last_attempt_at"), OffsetDateTime.class);
  private static final Field<String> LAST_ERROR = field(name(TBL, "last_error"), String.class);
  private static final Field<OffsetDateTime> UPDATED_AT =
      field(name(TBL, "updated_at"), OffsetDateTime.class);
  private static final Field<Long> REPORT_LOCATION =
      field(name(TBL, "report_location_page_id"), Long.class);
  private static final Field<Boolean> TEMPLATE_INITIALIZED =
      field(name(TBL, "template_initialized"), Boolean.class);
  private static final Field<Boolean> DAILY_TEMPLATE_MADE =
      field(name(TBL, "daily_template_made"), Boolean.class);
  private static final Field<Boolean> WEEKLY_TEMPLATE_MADE =
      field(name(TBL, "weekly_template_made"), Boolean.class);
  private static final Field<OffsetDateTime> TEMPLATE_RECREATED_AT =
      field(name(TBL, "template_recreated_at"), OffsetDateTime.class);

  private final DSLContext dsl;

  /**
   * 설정 한 행.
   *
   * @param dailyTemplatePageId 일일 템플릿 노트(없으면 null)
   * @param weeklyTemplatePageId 주간·월간 공용 템플릿 노트(없으면 null)
   * @param nextRunAt 다음 자동 일일 생성 시각(null = 꺼짐)
   * @param reportLocationPageId 사용자가 고른 보고 저장 위치(WP-1655, null = 기본 「보고」)
   * @param templateInitialized 「보고」 아래 옛 템플릿을 「템플릿」 으로 옮기는 판정을 마쳤는가(WP-1655)
   * @param dailyTemplateMade 일일 템플릿을 한 번이라도 만들었는가 — 지워져 id 가 비었을 때 「다시 만듦」 판정(WP-1655)
   * @param weeklyTemplateMade 주간·월간 템플릿을 한 번이라도 만들었는가(WP-1655)
   * @param templateRecreatedAt 없어진 템플릿을 다시 만든 시각 — 설정 화면 한 줄 알림(WP-1655, null = 알림 없음)
   */
  public record SettingRow(
      long userId,
      boolean dailyEnabled,
      LocalTime timeOfDay,
      boolean skipEmpty,
      Long dailyTemplatePageId,
      Long weeklyTemplatePageId,
      OffsetDateTime nextRunAt,
      int consecutiveFailures,
      String lastError,
      Long reportLocationPageId,
      boolean templateInitialized,
      boolean dailyTemplateMade,
      boolean weeklyTemplateMade,
      OffsetDateTime templateRecreatedAt) {

    /** 행이 없을 때의 기본값 — 꺼짐·09:00·한 일이 없는 날은 건너뜀. */
    public static SettingRow defaults(long userId) {
      return new SettingRow(
          userId,
          false,
          LocalTime.of(9, 0),
          true,
          null,
          null,
          null,
          0,
          null,
          null,
          false,
          false,
          false,
          null);
    }
  }

  /** 설정 행(없으면 비어 있다 — 호출자가 {@link SettingRow#defaults} 로 본다). */
  public Optional<SettingRow> find(long userId) {
    return dsl.select(
            USER_ID,
            DAILY_ENABLED,
            TIME_OF_DAY,
            SKIP_EMPTY,
            DAILY_TEMPLATE,
            WEEKLY_TEMPLATE,
            NEXT_RUN_AT,
            FAILURES,
            LAST_ERROR,
            REPORT_LOCATION,
            TEMPLATE_INITIALIZED,
            DAILY_TEMPLATE_MADE,
            WEEKLY_TEMPLATE_MADE,
            TEMPLATE_RECREATED_AT)
        .from(T)
        .where(USER_ID.eq(userId))
        .fetchOptional(PersonalReportSettingRepository::toRow);
  }

  /**
   * 자동 일일 설정을 저장한다(upsert). 끄면 다음 실행 시각은 비운다. 템플릿 칸은 건드리지 않는다. 충돌 대상은 PK (tenant_id, user_id) — 넣는
   * 행의 tenant_id 는 기본값(현재 테넌트)으로 채워진 뒤 충돌을 따진다.
   */
  public void save(
      long userId,
      boolean dailyEnabled,
      LocalTime time,
      boolean skipEmpty,
      OffsetDateTime nextRunAt) {
    OffsetDateTime next = dailyEnabled ? nextRunAt : null;
    dsl.insertInto(T)
        .columns(USER_ID, DAILY_ENABLED, TIME_OF_DAY, SKIP_EMPTY, NEXT_RUN_AT)
        .values(userId, dailyEnabled, time, skipEmpty, next)
        .onConflict(TENANT_ID, USER_ID)
        .doUpdate()
        .set(DAILY_ENABLED, dailyEnabled)
        .set(TIME_OF_DAY, time)
        .set(SKIP_EMPTY, skipEmpty)
        .set(NEXT_RUN_AT, next)
        .set(UPDATED_AT, OffsetDateTime.now())
        .execute();
  }

  /**
   * 템플릿 노트를 적는다(WP-1655) — DAILY 는 일일 칸, WEEKLY·MONTHLY 는 주간 칸. 그 종류의 「만든 적 있음」(*_template_made)도
   * 함께 켠다(id 가 지워져 NULL 이 돼도 다시 만들 때 알림을 띄우려고). recreated 면 「템플릿을 다시 만들었어요」 알림 시각을 지금으로 적고, 아니면 이미
   * 있던 알림 시각은 건드리지 않는다(다른 종류를 다시 만든 알림을 지우지 않게). 행이 없으면 기본값으로 만든다(충돌 대상 tenant_id, user_id).
   */
  public void setTemplate(long userId, PersonalReportKind kind, long pageId, boolean recreated) {
    boolean daily = kind == PersonalReportKind.DAILY;
    Field<Long> col = daily ? DAILY_TEMPLATE : WEEKLY_TEMPLATE;
    Field<Boolean> made = daily ? DAILY_TEMPLATE_MADE : WEEKLY_TEMPLATE_MADE;
    // 다시 만든 것이면 지금, 아니면 null — null 이면 충돌 갱신에서 coalesce 로 기존 알림 시각을 그대로 둔다.
    OffsetDateTime now = OffsetDateTime.now();
    OffsetDateTime recreatedAt = recreated ? now : null;
    dsl.insertInto(T)
        .columns(USER_ID, col, made, TEMPLATE_RECREATED_AT)
        .values(userId, pageId, true, recreatedAt)
        .onConflict(TENANT_ID, USER_ID)
        .doUpdate()
        .set(col, pageId)
        .set(made, true)
        .set(
            TEMPLATE_RECREATED_AT,
            DSL.coalesce(DSL.val(recreatedAt, OffsetDateTime.class), TEMPLATE_RECREATED_AT))
        .set(UPDATED_AT, now)
        .execute();
  }

  /** 「보고」 아래 옛 템플릿을 「템플릿」 으로 옮기는 판정을 마쳤다고 적는다(WP-1655) — 한 번만 옮기게. 행이 없으면 기본값으로 만든다. */
  public void markTemplateInitialized(long userId) {
    dsl.insertInto(T)
        .columns(USER_ID, TEMPLATE_INITIALIZED)
        .values(userId, true)
        .onConflict(TENANT_ID, USER_ID)
        .doUpdate()
        .set(TEMPLATE_INITIALIZED, true)
        .set(UPDATED_AT, DSL.currentOffsetDateTime())
        .execute();
  }

  /** 「템플릿을 다시 만들었어요」 알림을 지운다(WP-1655) — 사용자가 설정을 다시 쓸 때. 값이 있을 때만 바꾸고, 행이 없으면 아무것도 하지 않는다. */
  public void clearTemplateRecreated(long userId) {
    dsl.update(T)
        .setNull(TEMPLATE_RECREATED_AT)
        .where(USER_ID.eq(userId))
        .and(TEMPLATE_RECREATED_AT.isNotNull())
        .execute();
  }

  /** 보고 저장 위치를 적는다(WP-1655, null 이면 기본 「보고」) — 행이 없으면 기본 설정으로 만든다. */
  public void setLocation(long userId, Long pageId) {
    dsl.insertInto(T)
        .columns(USER_ID, REPORT_LOCATION)
        .values(userId, pageId)
        .onConflict(TENANT_ID, USER_ID)
        .doUpdate()
        .set(REPORT_LOCATION, pageId)
        .set(UPDATED_AT, DSL.currentOffsetDateTime())
        .execute();
  }

  /**
   * 저장 위치가 아직 expectedPageId 일 때만 지운다(WP-1655) — 생성기가 무효(다른 공간으로 옮겨짐)로 본 위치를 기본으로 되돌릴 때, 그사이 사용자가
   * 새로 고른 값을 지우지 않게 조건부로 한다.
   */
  public void clearLocationIf(long userId, long expectedPageId) {
    dsl.update(T)
        .setNull(REPORT_LOCATION)
        .where(USER_ID.eq(userId))
        .and(REPORT_LOCATION.eq(expectedPageId))
        .execute();
  }

  /**
   * 실행기가 이 사람의 이번 슬롯을 점유한다 — 켜져 있고 next_run_at 이 now 이하일 때만 다음 시각으로 옮긴다. 여러 파드가 같이 불러도 한 쪽만 true.
   */
  public boolean claim(long userId, OffsetDateTime now, OffsetDateTime next) {
    return dsl.update(T)
            .set(NEXT_RUN_AT, next)
            .set(LAST_ATTEMPT_AT, now)
            .where(USER_ID.eq(userId))
            .and(DAILY_ENABLED.isTrue())
            .and(NEXT_RUN_AT.le(now))
            .execute()
        == 1;
  }

  /** 실패를 적고 retryAt 에 다시 시도하게 한다. 연속 실패 수(+1 한 값)를 돌려준다. 오류는 앞 500자. */
  public int recordFailure(long userId, OffsetDateTime retryAt, String error) {
    return dsl.update(T)
        .set(NEXT_RUN_AT, retryAt)
        .set(FAILURES, FAILURES.plus(1))
        .set(LAST_ERROR, ReportErrors.trim(error))
        .set(UPDATED_AT, OffsetDateTime.now())
        .where(USER_ID.eq(userId))
        .returning(FAILURES)
        .fetchOptional()
        .map(r -> r.get(FAILURES))
        .orElse(0);
  }

  /**
   * 다음 시도 시각만 옮긴다(WP-2108) — 사용 한도 대기로 건너뛴 회차를 대기가 풀리는 시각에 다시 잡게 한다. 실패 수·오류는 건드리지 않는다. 꺼져 있으면 되살리지
   * 않는다.
   */
  public void retryAt(long userId, OffsetDateTime at) {
    dsl.update(T)
        .set(NEXT_RUN_AT, at)
        .set(UPDATED_AT, OffsetDateTime.now())
        .where(USER_ID.eq(userId))
        .and(DAILY_ENABLED.isTrue())
        .execute();
  }

  /** 연속 실패 상한 — 그날을 넘기고 다음 예정으로 옮긴다(실패 수 0, 오류 문구는 남김). */
  public void skipToNext(long userId, OffsetDateTime next, String error) {
    dsl.update(T)
        .set(NEXT_RUN_AT, next)
        .set(FAILURES, 0)
        .set(LAST_ERROR, ReportErrors.trim(error))
        .set(UPDATED_AT, OffsetDateTime.now())
        .where(USER_ID.eq(userId))
        .execute();
  }

  /** 성공했으니 실패 수와 오류 문구를 지운다. */
  public void resetFailures(long userId) {
    dsl.update(T)
        .set(FAILURES, 0)
        .setNull(LAST_ERROR)
        .set(UPDATED_AT, OffsetDateTime.now())
        .where(USER_ID.eq(userId))
        .execute();
  }

  /**
   * 지금 돌 차례인 사람들(켜짐·next_run_at ≤ now) — 이른 순, 최대 limit 명. 이 워크스페이스의 ACTIVE 멤버이고 계정이
   * 활성(user.is_active)인 사람만 — 정지된 멤버·비활성 계정의 설정 행이 남아 있어도 AI 보고를 만들지 않는다(membership·user 는 RLS
   * 비대상이라 설정 행의 tenant_id 로 잇는다).
   */
  public List<Long> dueUserIds(OffsetDateTime now, int limit) {
    return dsl.select(USER_ID)
        .from(T)
        .join(MEMBERSHIP)
        .on(MEMBERSHIP.USER_ID.eq(USER_ID))
        .and(MEMBERSHIP.TENANT_ID.eq(TENANT_ID))
        .and(MEMBERSHIP.STATUS.eq("ACTIVE"))
        .join(USER)
        .on(USER.ID.eq(USER_ID))
        .and(USER.IS_ACTIVE.isTrue())
        .where(DAILY_ENABLED.isTrue())
        .and(NEXT_RUN_AT.le(now))
        .orderBy(NEXT_RUN_AT.asc(), USER_ID.asc())
        .limit(limit)
        .fetch(USER_ID);
  }

  private static SettingRow toRow(Record r) {
    return new SettingRow(
        r.get(USER_ID),
        r.get(DAILY_ENABLED),
        r.get(TIME_OF_DAY),
        r.get(SKIP_EMPTY),
        r.get(DAILY_TEMPLATE),
        r.get(WEEKLY_TEMPLATE),
        r.get(NEXT_RUN_AT),
        r.get(FAILURES),
        r.get(LAST_ERROR),
        r.get(REPORT_LOCATION),
        r.get(TEMPLATE_INITIALIZED),
        r.get(DAILY_TEMPLATE_MADE),
        r.get(WEEKLY_TEMPLATE_MADE),
        r.get(TEMPLATE_RECREATED_AT));
  }
}
