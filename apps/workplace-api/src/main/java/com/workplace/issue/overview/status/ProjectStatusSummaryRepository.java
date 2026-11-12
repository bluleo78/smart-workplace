package com.workplace.issue.overview.status;

import static org.jooq.impl.DSL.field;
import static org.jooq.impl.DSL.name;
import static org.jooq.impl.DSL.table;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
import org.jooq.Field;
import org.jooq.Table;
import org.springframework.stereotype.Repository;

/**
 * 프로젝트 상태 AI 요약(project_status_summary) 저장소(WP-1479). 프로젝트당 한 행.
 *
 * <p>jOOQ 코드 생성 없이 plain SQL 필드로 다룬다(마이그레이션 직후 생성 클래스 갱신을 기다리지 않게). 테넌트 격리는 RLS 와 tenant_id
 * 기본값(app.tenant_id)이 맡는다.
 */
@Repository
@RequiredArgsConstructor
public class ProjectStatusSummaryRepository {

  private static final Table<?> T = table(name("project_status_summary"));
  private static final Field<Long> PROJECT_ID =
      field(name("project_status_summary", "project_id"), Long.class);
  private static final Field<String> BADGE =
      field(name("project_status_summary", "badge"), String.class);
  private static final Field<String> SUMMARY =
      field(name("project_status_summary", "summary"), String.class);
  private static final Field<String> INPUT_HASH =
      field(name("project_status_summary", "input_hash"), String.class);
  private static final Field<OffsetDateTime> GENERATED_AT =
      field(name("project_status_summary", "generated_at"), OffsetDateTime.class);
  private static final Field<OffsetDateTime> CHECKED_AT =
      field(name("project_status_summary", "checked_at"), OffsetDateTime.class);
  private static final Field<OffsetDateTime> NEXT_RUN_AT =
      field(name("project_status_summary", "next_run_at"), OffsetDateTime.class);

  private final DSLContext dsl;

  /** 프로젝트의 최신 요약 행 — 한 번도 만들지 않았으면 비어 있다. */
  public Optional<StatusSummaryRow> find(long projectId) {
    return dsl.select(PROJECT_ID, BADGE, SUMMARY, INPUT_HASH, GENERATED_AT, CHECKED_AT, NEXT_RUN_AT)
        .from(T)
        .where(PROJECT_ID.eq(projectId))
        .fetchOptional(
            r ->
                new StatusSummaryRow(
                    r.get(PROJECT_ID),
                    r.get(BADGE),
                    r.get(SUMMARY),
                    r.get(INPUT_HASH),
                    r.get(GENERATED_AT),
                    r.get(CHECKED_AT),
                    r.get(NEXT_RUN_AT)));
  }

  /**
   * 이번 주기의 실행권을 잡는다 — 행이 없으면 만들고(next_run_at = nextRunAt), 있으면 next_run_at 이 비었거나 now 이하일 때만
   * nextRunAt 으로 민다. 한 SQL(upsert)이라 같은 주기에 여러 인스턴스가 동시에 불러도 한 쪽만 true 다.
   */
  public boolean claim(long projectId, OffsetDateTime now, OffsetDateTime nextRunAt) {
    return dsl.insertInto(T)
            .columns(PROJECT_ID, NEXT_RUN_AT)
            .values(projectId, nextRunAt)
            .onConflict(PROJECT_ID)
            .doUpdate()
            .set(NEXT_RUN_AT, nextRunAt)
            .where(NEXT_RUN_AT.isNull().or(NEXT_RUN_AT.le(now)))
            .execute()
        == 1;
  }

  /** AI 가 새로 만든 요약을 저장한다 — 생성·점검 시각을 같은 값으로 적는다. */
  public void saveGenerated(
      long projectId, String badge, String summary, String inputHash, OffsetDateTime at) {
    dsl.insertInto(T)
        .columns(PROJECT_ID, BADGE, SUMMARY, INPUT_HASH, GENERATED_AT, CHECKED_AT)
        .values(projectId, badge, summary, inputHash, at, at)
        .onConflict(PROJECT_ID)
        .doUpdate()
        .set(BADGE, badge)
        .set(SUMMARY, summary)
        .set(INPUT_HASH, inputHash)
        .set(GENERATED_AT, at)
        .set(CHECKED_AT, at)
        .execute();
  }

  /** 입력이 그대로라 AI 를 부르지 않은 점검 — 점검 시각만 갱신한다. */
  public void touchChecked(long projectId, OffsetDateTime at) {
    dsl.update(T).set(CHECKED_AT, at).where(PROJECT_ID.eq(projectId)).execute();
  }

  /**
   * 요약할 것이 없어진 프로젝트의 옛 요약을 지운다 — 배지·글·입력 해시·생성 시각을 비우고 점검 시각만 at 으로 적는다. 글이 없으면 개요가 카드를 숨기고, 해시가 비어
   * 다음에 이슈가 생기면 바로 새로 쓴다. 행이 없으면(점유 전) 아무것도 하지 않는다.
   */
  public void clearSummary(long projectId, OffsetDateTime at) {
    dsl.update(T)
        .setNull(BADGE)
        .setNull(SUMMARY)
        .setNull(INPUT_HASH)
        .setNull(GENERATED_AT)
        .set(CHECKED_AT, at)
        .where(PROJECT_ID.eq(projectId))
        .execute();
  }

  /**
   * 다음 실행 시각이 candidate 보다 늦으면 candidate 로 당긴다(least) — 간격을 줄였을 때 옛 긴 간격을 기다리지 않게. 행이 없거나
   * next_run_at 이 비어(즉시 대상) 있으면 이미 더 빠르므로 건드리지 않는다.
   */
  public void pullNextRunForward(long projectId, OffsetDateTime candidate) {
    dsl.update(T)
        .set(NEXT_RUN_AT, candidate)
        .where(PROJECT_ID.eq(projectId).and(NEXT_RUN_AT.gt(candidate)))
        .execute();
  }

  /**
   * 지금 요약을 점검할 프로젝트 id(id 순, 최대 limit 개) — 삭제(보관)·개인 프로젝트는 뺀다. 행이 없거나 next_run_at 이 비었거나 now 이하면
   * 대상이다. 스케줄러가 회차 상한의 남은 자리만큼만 받아 가도록 SQL 에서 자른다.
   */
  public List<Long> dueProjectIds(OffsetDateTime now, int limit) {
    Field<Long> pid = field(name("project", "id"), Long.class);
    Field<OffsetDateTime> deletedAt = field(name("project", "deleted_at"), OffsetDateTime.class);
    Field<String> type = field(name("project", "type"), String.class);
    return dsl.select(pid)
        .from(table(name("project")))
        .leftJoin(T)
        .on(PROJECT_ID.eq(pid))
        .where(deletedAt.isNull())
        .and(type.ne("PERSONAL"))
        .and(NEXT_RUN_AT.isNull().or(NEXT_RUN_AT.le(now)))
        .orderBy(pid)
        .limit(limit)
        .fetch(pid);
  }
}
