package com.workplace.home.repository;

import static com.workplace.jooq.Tables.AI_MEMORY_CHANGE;
import static com.workplace.jooq.Tables.HOME_SESSION;

import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.jooq.Condition;
import org.jooq.DSLContext;
import org.jooq.JSONB;
import org.jooq.Record;
import org.jooq.SelectField;
import org.jooq.SelectOnConditionStep;
import org.jooq.impl.DSL;
import org.springframework.stereotype.Repository;

/**
 * 「AI가 정리함」 기록(WP-385 스펙 3·8) — 배경 정리·감쇠 삭제가 쓰고, 기록 화면이 읽고 되돌린다. <b>보관 정리({@link
 * #deleteOlderThan})를 빼면 모든 쿼리는 user_id 로 거른다</b>. 테넌트는 RLS(GUC) 라 테넌트 트랜잭션 안에서 부른다. created_at 은
 * 앱이 밀리초로 잘라 넣는다 — 키셋 커서(CursorCodec)가 밀리초라 마이크로초가 남으면 페이지 경계에서 행이 빠진다.
 */
@Repository
@RequiredArgsConstructor
public class AiMemoryChangeRepository {

  private final DSLContext dsl;

  /** 새 기록 1건. beforeJson 은 스냅숏 배열 JSON, afterJson 은 스냅숏 JSON(지움이면 null). */
  public record NewChange(
      long userId,
      UUID runId,
      String action,
      long memoryId,
      String beforeJson,
      String afterJson,
      UUID sourceSessionId,
      String reason,
      OffsetDateTime createdAt) {}

  /** 기록 1건 — sessionTitle 은 출처 대화 제목(목록·단건 조회만, 대화가 지워졌거나 잠금 조회면 null). */
  public record ChangeRow(
      long id,
      String action,
      long memoryId,
      String beforeJson,
      String afterJson,
      UUID sourceSessionId,
      String sessionTitle,
      String reason,
      Instant createdAt,
      Instant undoneAt) {}

  /**
   * 메모리마다 되돌리지 않은 최신 정리(ADDED·UPDATED·MERGED) 기록 — 남긴 대화(없으면 null: 대화가 지워짐 등)·after JSON·시각. 설정 목록의
   * 「AI가 정리」 판정과 배경 정리의 "지금 행이 이 대화의 앞선 정리 결과 그대로인가" 판정이 함께 쓴다.
   */
  public record LatestCleanup(
      long memoryId, UUID sourceSessionId, String afterJson, Instant createdAt) {}

  private static final List<SelectField<?>> FIELDS =
      List.of(
          AI_MEMORY_CHANGE.ID,
          AI_MEMORY_CHANGE.ACTION,
          AI_MEMORY_CHANGE.MEMORY_ID,
          AI_MEMORY_CHANGE.BEFORE,
          AI_MEMORY_CHANGE.AFTER,
          AI_MEMORY_CHANGE.SOURCE_SESSION_ID,
          AI_MEMORY_CHANGE.REASON,
          AI_MEMORY_CHANGE.CREATED_AT,
          AI_MEMORY_CHANGE.UNDONE_AT);

  /** 기록 1건 저장 후 id. */
  public long insert(NewChange c) {
    return dsl.insertInto(AI_MEMORY_CHANGE)
        .set(AI_MEMORY_CHANGE.USER_ID, c.userId())
        .set(AI_MEMORY_CHANGE.RUN_ID, c.runId())
        .set(AI_MEMORY_CHANGE.ACTION, c.action())
        .set(AI_MEMORY_CHANGE.MEMORY_ID, c.memoryId())
        .set(AI_MEMORY_CHANGE.BEFORE, JSONB.valueOf(c.beforeJson()))
        .set(AI_MEMORY_CHANGE.AFTER, c.afterJson() == null ? null : JSONB.valueOf(c.afterJson()))
        .set(AI_MEMORY_CHANGE.SOURCE_SESSION_ID, c.sourceSessionId())
        .set(AI_MEMORY_CHANGE.REASON, c.reason())
        .set(AI_MEMORY_CHANGE.CREATED_AT, c.createdAt())
        .returning(AI_MEMORY_CHANGE.ID)
        .fetchOne(AI_MEMORY_CHANGE.ID);
  }

  /** 기록 여러 건을 다건 INSERT 한 번으로 저장한다(감쇠 삭제의 DECAYED 기록) — 저장한 수. 빈 목록이면 아무것도 하지 않는다. */
  public int insertAll(List<NewChange> changes) {
    if (changes.isEmpty()) return 0;
    var step =
        dsl.insertInto(
            AI_MEMORY_CHANGE,
            AI_MEMORY_CHANGE.USER_ID,
            AI_MEMORY_CHANGE.RUN_ID,
            AI_MEMORY_CHANGE.ACTION,
            AI_MEMORY_CHANGE.MEMORY_ID,
            AI_MEMORY_CHANGE.BEFORE,
            AI_MEMORY_CHANGE.AFTER,
            AI_MEMORY_CHANGE.SOURCE_SESSION_ID,
            AI_MEMORY_CHANGE.REASON,
            AI_MEMORY_CHANGE.CREATED_AT);
    for (NewChange c : changes) {
      step =
          step.values(
              c.userId(),
              c.runId(),
              c.action(),
              c.memoryId(),
              JSONB.valueOf(c.beforeJson()),
              c.afterJson() == null ? null : JSONB.valueOf(c.afterJson()),
              c.sourceSessionId(),
              c.reason(),
              c.createdAt());
    }
    return step.execute();
  }

  /**
   * 본인 기록 최신순 limit 건 — 커서(createdAt·id) 다음부터. 출처 대화 제목을 함께 읽는다(지워졌으면 null). 커서 id 가 숫자가 아니면 첫 페이지.
   */
  public List<ChangeRow> page(long userId, CursorCodec.Decoded cursor, int limit) {
    Condition where = AI_MEMORY_CHANGE.USER_ID.eq(userId);
    Long cursorId = cursor == null ? null : cursor.longId();
    if (cursorId != null) {
      where =
          where.and(
              DSL.row(AI_MEMORY_CHANGE.CREATED_AT, AI_MEMORY_CHANGE.ID)
                  .lessThan(
                      OffsetDateTime.ofInstant(cursor.createdAt(), ZoneOffset.UTC), cursorId));
    }
    return withSession()
        .where(where)
        .orderBy(AI_MEMORY_CHANGE.CREATED_AT.desc(), AI_MEMORY_CHANGE.ID.desc())
        .limit(limit)
        .fetch(r -> toRow(r, r.get(HOME_SESSION.TITLE)));
  }

  /** 본인 기록 1건(출처 대화 제목 포함). */
  public Optional<ChangeRow> find(long userId, long id) {
    return withSession()
        .where(AI_MEMORY_CHANGE.ID.eq(id))
        .and(AI_MEMORY_CHANGE.USER_ID.eq(userId))
        .fetchOptional(r -> toRow(r, r.get(HOME_SESSION.TITLE)));
  }

  /** 본인 기록 행 잠금 — 같은 기록의 동시 되돌리기를 줄 세운다(제목은 읽지 않는다). */
  public Optional<ChangeRow> lock(long userId, long id) {
    return dsl.select(FIELDS)
        .from(AI_MEMORY_CHANGE)
        .where(AI_MEMORY_CHANGE.ID.eq(id))
        .and(AI_MEMORY_CHANGE.USER_ID.eq(userId))
        .forUpdate()
        .fetchOptional(r -> toRow(r, null));
  }

  /** 본인 기록의 되돌림 표시 — 남의 기록이면 0행. */
  public int markUndone(long userId, long id, OffsetDateTime at) {
    return dsl.update(AI_MEMORY_CHANGE)
        .set(AI_MEMORY_CHANGE.UNDONE_AT, at)
        .where(AI_MEMORY_CHANGE.ID.eq(id))
        .and(AI_MEMORY_CHANGE.USER_ID.eq(userId))
        .execute();
  }

  /** since 이후 본인 기록 수(되돌린 것 포함) — 안내 줄의 「n번」. */
  public int countSince(long userId, OffsetDateTime since) {
    return dsl.fetchCount(
        AI_MEMORY_CHANGE,
        AI_MEMORY_CHANGE.USER_ID.eq(userId).and(AI_MEMORY_CHANGE.CREATED_AT.ge(since)));
  }

  /**
   * memoryIds 중 since 뒤에 되돌린 기록이 있는 메모리 id — 배경 정리가 "대화가 끝난 뒤 사용자가 기록 화면에서 되돌린 메모리"를 대상에서 뺄 때
   * 쓴다(WP-385 코드 리뷰 10). ids 가 비면 빈 집합.
   */
  public Set<Long> undoneAfter(long userId, Collection<Long> memoryIds, Instant since) {
    if (memoryIds.isEmpty()) return Set.of();
    return dsl.selectDistinct(AI_MEMORY_CHANGE.MEMORY_ID)
        .from(AI_MEMORY_CHANGE)
        .where(AI_MEMORY_CHANGE.USER_ID.eq(userId))
        .and(AI_MEMORY_CHANGE.MEMORY_ID.eq(DSL.any(memoryIds.toArray(Long[]::new))))
        .and(AI_MEMORY_CHANGE.UNDONE_AT.gt(OffsetDateTime.ofInstant(since, ZoneOffset.UTC)))
        .fetchSet(AI_MEMORY_CHANGE.MEMORY_ID);
  }

  /** 보관 기간이 지난 기록을 지운다(테넌트 안 모든 사용자 — TenantScopedRunner 트랜잭션에서만). */
  public int deleteOlderThan(OffsetDateTime cutoff) {
    return dsl.deleteFrom(AI_MEMORY_CHANGE).where(AI_MEMORY_CHANGE.CREATED_AT.lt(cutoff)).execute();
  }

  /**
   * memoryIds 각각의 되돌리지 않은 최신 ADDED·UPDATED·MERGED 기록(DISTINCT ON) — 기록이 없는 메모리는 빠진다. ids 가 비면 빈 목록.
   * 보관이 30일이라 사용자당 행이 적다.
   */
  public List<LatestCleanup> latestCleanups(long userId, Collection<Long> memoryIds) {
    if (memoryIds.isEmpty()) return List.of();
    return dsl.select(
            AI_MEMORY_CHANGE.MEMORY_ID,
            AI_MEMORY_CHANGE.SOURCE_SESSION_ID,
            AI_MEMORY_CHANGE.AFTER,
            AI_MEMORY_CHANGE.CREATED_AT)
        .distinctOn(AI_MEMORY_CHANGE.MEMORY_ID)
        .from(AI_MEMORY_CHANGE)
        .where(AI_MEMORY_CHANGE.USER_ID.eq(userId))
        .and(AI_MEMORY_CHANGE.MEMORY_ID.eq(DSL.any(memoryIds.toArray(Long[]::new))))
        .and(AI_MEMORY_CHANGE.UNDONE_AT.isNull())
        .and(AI_MEMORY_CHANGE.ACTION.in("ADDED", "UPDATED", "MERGED"))
        .orderBy(
            AI_MEMORY_CHANGE.MEMORY_ID,
            AI_MEMORY_CHANGE.CREATED_AT.desc(),
            AI_MEMORY_CHANGE.ID.desc())
        .fetch(
            r ->
                new LatestCleanup(
                    r.value1(),
                    r.value2(),
                    r.value3() == null ? null : r.value3().data(),
                    r.value4().toInstant()));
  }

  /** 기록 + 출처 대화 제목(LEFT JOIN — 대화가 지워지면 source_session_id 도 NULL). */
  private SelectOnConditionStep<Record> withSession() {
    List<SelectField<?>> fields = new ArrayList<>(FIELDS);
    fields.add(HOME_SESSION.TITLE);
    return dsl.select(fields)
        .from(AI_MEMORY_CHANGE)
        .leftJoin(HOME_SESSION)
        .on(HOME_SESSION.ID.eq(AI_MEMORY_CHANGE.SOURCE_SESSION_ID));
  }

  private static ChangeRow toRow(Record r, String sessionTitle) {
    JSONB after = r.get(AI_MEMORY_CHANGE.AFTER);
    OffsetDateTime undone = r.get(AI_MEMORY_CHANGE.UNDONE_AT);
    return new ChangeRow(
        r.get(AI_MEMORY_CHANGE.ID),
        r.get(AI_MEMORY_CHANGE.ACTION),
        r.get(AI_MEMORY_CHANGE.MEMORY_ID),
        r.get(AI_MEMORY_CHANGE.BEFORE).data(),
        after == null ? null : after.data(),
        r.get(AI_MEMORY_CHANGE.SOURCE_SESSION_ID),
        sessionTitle,
        r.get(AI_MEMORY_CHANGE.REASON),
        r.get(AI_MEMORY_CHANGE.CREATED_AT).toInstant(),
        undone == null ? null : undone.toInstant());
  }
}
