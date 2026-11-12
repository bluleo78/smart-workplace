package com.workplace.wiki.report;

import static org.jooq.impl.DSL.field;
import static org.jooq.impl.DSL.name;
import static org.jooq.impl.DSL.table;

import com.workplace.issue.report.ReportCadence;
import java.time.DayOfWeek;
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
 * 프로젝트 리포트 설정(project_report_setting, V288) 저장소(WP-1483). 프로젝트당 한 행 — 없으면 기본값(꺼짐·매주·월요일·09:00)으로
 * 본다.
 *
 * <p>jOOQ 코드 생성 없이 이름(DSL.name)으로 다룬다(V285 상태 요약과 같은 방식). 테넌트 격리는 RLS 와 tenant_id
 * 기본값(app.tenant_id)이 맡는다 — 모든 메서드는 트랜잭션 안에서 불러야 한다.
 */
@Repository
@RequiredArgsConstructor
public class ProjectReportSettingRepository {

  /** last_error 에 남기는 최대 글자 수(설계 「데이터」). */
  static final int ERROR_MAX = 500;

  private static final String TBL = "project_report_setting";
  private static final Table<?> T = table(name(TBL));
  private static final Field<Long> PROJECT_ID = field(name(TBL, "project_id"), Long.class);
  private static final Field<Boolean> ENABLED = field(name(TBL, "enabled"), Boolean.class);
  private static final Field<String> CADENCE = field(name(TBL, "cadence"), String.class);
  private static final Field<String> WEEKDAY = field(name(TBL, "weekday"), String.class);
  private static final Field<LocalTime> TIME_OF_DAY =
      field(name(TBL, "time_of_day"), LocalTime.class);
  private static final Field<Long> TEMPLATE_PAGE_ID =
      field(name(TBL, "template_page_id"), Long.class);
  private static final Field<OffsetDateTime> NEXT_RUN_AT =
      field(name(TBL, "next_run_at"), OffsetDateTime.class);
  private static final Field<Integer> CONSECUTIVE_FAILURES =
      field(name(TBL, "consecutive_failures"), Integer.class);
  private static final Field<OffsetDateTime> LAST_ATTEMPT_AT =
      field(name(TBL, "last_attempt_at"), OffsetDateTime.class);
  private static final Field<String> LAST_ERROR = field(name(TBL, "last_error"), String.class);
  private static final Field<OffsetDateTime> UPDATED_AT =
      field(name(TBL, "updated_at"), OffsetDateTime.class);

  private final DSLContext dsl;

  /**
   * 설정 한 행.
   *
   * @param timeOfDay KST 정시
   * @param templatePageId 템플릿 노트(지워졌으면 null)
   * @param nextRunAt 다음 생성 시각(꺼졌으면 null)
   */
  public record SettingRow(
      long projectId,
      boolean enabled,
      ReportCadence cadence,
      DayOfWeek weekday,
      LocalTime timeOfDay,
      Long templatePageId,
      OffsetDateTime nextRunAt,
      int consecutiveFailures) {

    /** 행이 없는 프로젝트의 기본 설정 — 꺼짐·매주·월요일·09:00. */
    public static SettingRow defaults(long projectId) {
      return new SettingRow(
          projectId,
          false,
          ReportCadence.WEEKLY,
          DayOfWeek.MONDAY,
          LocalTime.of(9, 0),
          null,
          null,
          0);
    }
  }

  /** 프로젝트의 설정 행 — 한 번도 저장하지 않았으면 비어 있다. */
  public Optional<SettingRow> find(long projectId) {
    return dsl.select(
            PROJECT_ID,
            ENABLED,
            CADENCE,
            WEEKDAY,
            TIME_OF_DAY,
            TEMPLATE_PAGE_ID,
            NEXT_RUN_AT,
            CONSECUTIVE_FAILURES)
        .from(T)
        .where(PROJECT_ID.eq(projectId))
        .fetchOptional(ProjectReportSettingRepository::toRow);
  }

  private static SettingRow toRow(Record r) {
    return new SettingRow(
        r.get(PROJECT_ID),
        r.get(ENABLED),
        ReportCadence.parse(r.get(CADENCE)),
        DayOfWeek.valueOf(r.get(WEEKDAY)),
        r.get(TIME_OF_DAY),
        r.get(TEMPLATE_PAGE_ID),
        r.get(NEXT_RUN_AT),
        r.get(CONSECUTIVE_FAILURES));
  }

  /**
   * 설정 화면 저장 — 켬·주기·요일·시각만 쓴다. 템플릿은 {@link #setTemplate} 이, 점유·재시도 상태는 실행기가 맡으므로 건드리지 않는다.
   *
   * <p>{@code reschedule} 이면(켬·일정이 바뀜) 다음 실행 시각을 nextRunAt 으로 다시 정하고 실패 수·오류를 지운다. 아니면
   * next_run_at·실패 수를 그대로 둔다 — 실행 중에 일정이 같은 저장이 들어와도 실행기가 정한 다음 예정·30분 재시도를 덮지 않게(통째 덮어쓰기 경쟁 방지).
   */
  public void saveSettings(
      long projectId,
      boolean enabled,
      ReportCadence cadence,
      DayOfWeek weekday,
      LocalTime timeOfDay,
      boolean reschedule,
      OffsetDateTime nextRunAt) {
    var update =
        dsl.insertInto(T)
            .columns(PROJECT_ID, ENABLED, CADENCE, WEEKDAY, TIME_OF_DAY, NEXT_RUN_AT)
            .values(projectId, enabled, cadence.name(), weekday.name(), timeOfDay, nextRunAt)
            .onConflict(PROJECT_ID)
            .doUpdate()
            .set(ENABLED, enabled)
            .set(CADENCE, cadence.name())
            .set(WEEKDAY, weekday.name())
            .set(TIME_OF_DAY, timeOfDay)
            .set(UPDATED_AT, DSL.currentOffsetDateTime());
    if (reschedule) {
      update.set(NEXT_RUN_AT, nextRunAt).set(CONSECUTIVE_FAILURES, 0).setNull(LAST_ERROR).execute();
    } else {
      update.execute();
    }
  }

  /** 템플릿 페이지를 적는다 — 행이 없으면 기본 설정으로 만든다(템플릿만 먼저 복사되는 경로). */
  public void setTemplate(long projectId, long pageId) {
    dsl.insertInto(T)
        .columns(PROJECT_ID, TEMPLATE_PAGE_ID)
        .values(projectId, pageId)
        .onConflict(PROJECT_ID)
        .doUpdate()
        .set(TEMPLATE_PAGE_ID, pageId)
        .set(UPDATED_AT, DSL.currentOffsetDateTime())
        .execute();
  }

  /**
   * 이번 실행권을 잡는다 — 켜져 있고 next_run_at 이 now 이하일 때만 nextRunAt 으로 밀고 시도 시각을 적는다. 한 SQL 의 조건부 갱신이라 여러
   * 인스턴스가 동시에 불러도 한 쪽만 true 다.
   */
  public boolean claim(long projectId, OffsetDateTime now, OffsetDateTime nextRunAt) {
    return dsl.update(T)
            .set(NEXT_RUN_AT, nextRunAt)
            .set(LAST_ATTEMPT_AT, now)
            .where(PROJECT_ID.eq(projectId))
            .and(ENABLED.isTrue())
            .and(NEXT_RUN_AT.le(now))
            .execute()
        == 1;
  }

  /**
   * 실패 기록 — 연속 실패 수를 올리고 다음 시도 시각(재시도 또는 다음 예정)과 오류 앞 500자를 남긴다.
   *
   * @return 올린 뒤의 연속 실패 수(행이 없으면 0) — 다시 읽지 않고 상한을 판단하게
   */
  public int recordFailure(long projectId, OffsetDateTime nextRunAt, String error) {
    return dsl.update(T)
        .set(CONSECUTIVE_FAILURES, CONSECUTIVE_FAILURES.plus(1))
        // 실행 중에 꺼졌으면(설정 저장이 next_run_at 을 비움) 재시도 시각을 되살리지 않는다.
        .set(NEXT_RUN_AT, DSL.when(ENABLED.isTrue(), DSL.val(nextRunAt, OffsetDateTime.class)))
        .set(LAST_ERROR, trim(error))
        .set(LAST_ATTEMPT_AT, DSL.currentOffsetDateTime())
        .where(PROJECT_ID.eq(projectId))
        .returning(CONSECUTIVE_FAILURES)
        .fetchOptional(CONSECUTIVE_FAILURES)
        .orElse(0);
  }

  /**
   * 연속 실패가 상한에 닿아 그 회차를 버린다 — 다음 예정으로 넘기고 실패 수를 0 으로. 마지막 오류(앞 500자)는 운영자가 볼 수 있게 남긴다. 그 사이 꺼졌으면 다음
   * 실행 시각을 되살리지 않는다.
   */
  public void skipToNext(long projectId, OffsetDateTime nextRunAt, String error) {
    dsl.update(T)
        .set(CONSECUTIVE_FAILURES, 0)
        .set(NEXT_RUN_AT, DSL.when(ENABLED.isTrue(), DSL.val(nextRunAt, OffsetDateTime.class)))
        .set(LAST_ERROR, trim(error))
        .set(LAST_ATTEMPT_AT, DSL.currentOffsetDateTime())
        .where(PROJECT_ID.eq(projectId))
        .execute();
  }

  /** 오류 글 앞 {@link #ERROR_MAX} 자. */
  private static String trim(String error) {
    return error == null
        ? null
        : error.length() > ERROR_MAX ? error.substring(0, ERROR_MAX) : error;
  }

  /** 성공(또는 회차를 넘김) — 연속 실패 수와 오류를 지운다. */
  public void resetFailures(long projectId) {
    dsl.update(T)
        .set(CONSECUTIVE_FAILURES, 0)
        .setNull(LAST_ERROR)
        .where(PROJECT_ID.eq(projectId))
        .execute();
  }

  /**
   * 지금 리포트를 만들 프로젝트 id(다음 실행이 이른 순, 최대 limit 개) — 켜져 있고 next_run_at 이 now 이하인 것. 지워진·개인 프로젝트는 뺀다.
   */
  public List<Long> dueProjectIds(OffsetDateTime now, int limit) {
    Field<Long> pid = field(name("project", "id"), Long.class);
    Field<OffsetDateTime> deletedAt = field(name("project", "deleted_at"), OffsetDateTime.class);
    Field<String> type = field(name("project", "type"), String.class);
    return dsl.select(PROJECT_ID)
        .from(T)
        .join(table(name("project")))
        .on(pid.eq(PROJECT_ID))
        .where(ENABLED.isTrue())
        .and(NEXT_RUN_AT.le(now))
        .and(deletedAt.isNull())
        .and(type.ne("PERSONAL"))
        .orderBy(NEXT_RUN_AT.asc(), PROJECT_ID.asc())
        .limit(limit)
        .fetch(PROJECT_ID);
  }
}
