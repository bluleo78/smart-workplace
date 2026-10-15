package com.workplace.home.repository;

import static com.workplace.jooq.Tables.SHARED_AI_MEMORY_CHANGE;

import com.workplace.home.service.SharedSpace.SpaceKey;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.jooq.Condition;
import org.jooq.DSLContext;
import org.jooq.JSONB;
import org.jooq.Record;
import org.jooq.impl.DSL;
import org.springframework.stereotype.Repository;

/**
 * 공간 기록(WP-386 스펙 4절) — 사람·AI 의 모든 변경. 공간 키로 거르고(보관 정리·id 단건 조회를 빼면), 최신순 키셋 페이지·되돌리기용 잠금·90일 보관
 * 정리를 둔다. 테넌트는 RLS(GUC) 라 테넌트 트랜잭션 안에서 부른다. created_at 은 앱이 밀리초로 잘라 넣는다(SharedAiMemoryChangeLog) —
 * 키셋 커서가 밀리초라서.
 */
@Repository
@RequiredArgsConstructor
public class SharedAiMemoryChangeRepository {

  private final DSLContext dsl;

  /** 새 기록. actorUserId 가 null 이면 AI. */
  public record NewChange(
      SpaceKey space,
      UUID runId,
      String action,
      Long actorUserId,
      String actorKind,
      long memoryId,
      String beforeJson,
      String afterJson,
      OffsetDateTime createdAt) {}

  /** 기록 한 줄. */
  public record ChangeRow(
      long id,
      String spaceType,
      Long spaceId,
      UUID runId,
      String action,
      Long actorUserId,
      String actorKind,
      long memoryId,
      String beforeJson,
      String afterJson,
      Instant createdAt,
      Instant undoneAt,
      Long undoneBy) {

    /** 이 기록의 공간 키. */
    public SpaceKey spaceKey() {
      return SpaceKey.of(spaceType, spaceId);
    }
  }

  /** 새 기록 저장 후 id. 시각은 키셋 커서가 밀리초라 여기서도 밀리초로 자른다(어느 호출자든 같은 규칙). */
  public long insert(NewChange c) {
    return dsl.insertInto(SHARED_AI_MEMORY_CHANGE)
        .set(SHARED_AI_MEMORY_CHANGE.SPACE_TYPE, c.space().type())
        .set(SHARED_AI_MEMORY_CHANGE.SPACE_ID, c.space().id())
        .set(SHARED_AI_MEMORY_CHANGE.RUN_ID, c.runId())
        .set(SHARED_AI_MEMORY_CHANGE.ACTION, c.action())
        .set(SHARED_AI_MEMORY_CHANGE.ACTOR_USER_ID, c.actorUserId())
        .set(SHARED_AI_MEMORY_CHANGE.ACTOR_KIND, c.actorKind())
        .set(SHARED_AI_MEMORY_CHANGE.MEMORY_ID, c.memoryId())
        .set(SHARED_AI_MEMORY_CHANGE.BEFORE, JSONB.valueOf(c.beforeJson()))
        .set(
            SHARED_AI_MEMORY_CHANGE.AFTER,
            c.afterJson() == null ? null : JSONB.valueOf(c.afterJson()))
        .set(SHARED_AI_MEMORY_CHANGE.CREATED_AT, c.createdAt().truncatedTo(ChronoUnit.MILLIS))
        .returning(SHARED_AI_MEMORY_CHANGE.ID)
        .fetchOne(SHARED_AI_MEMORY_CHANGE.ID);
  }

  /** 공간 기록 최신순 limit 건 — 커서(createdAt·id) 다음부터. 커서 id 가 숫자가 아니면 첫 페이지(변조 커서 500 방어). */
  public List<ChangeRow> page(SpaceKey k, CursorCodec.Decoded cursor, int limit) {
    Condition where =
        SharedAiMemoryRepository.inSpace(
            SHARED_AI_MEMORY_CHANGE.SPACE_TYPE, SHARED_AI_MEMORY_CHANGE.SPACE_ID, k);
    Long cursorId = cursor == null ? null : cursor.longId();
    if (cursorId != null) {
      where =
          where.and(
              DSL.row(SHARED_AI_MEMORY_CHANGE.CREATED_AT, SHARED_AI_MEMORY_CHANGE.ID)
                  .lessThan(
                      OffsetDateTime.ofInstant(cursor.createdAt(), ZoneOffset.UTC), cursorId));
    }
    return dsl.selectFrom(SHARED_AI_MEMORY_CHANGE)
        .where(where)
        .orderBy(SHARED_AI_MEMORY_CHANGE.CREATED_AT.desc(), SHARED_AI_MEMORY_CHANGE.ID.desc())
        .limit(limit)
        .fetch(SharedAiMemoryChangeRepository::toRow);
  }

  /** 기록 1건 — 공간 소속은 호출자가 {@link ChangeRow#spaceKey()} 로 확인한다. */
  public Optional<ChangeRow> find(long id) {
    return dsl.selectFrom(SHARED_AI_MEMORY_CHANGE)
        .where(SHARED_AI_MEMORY_CHANGE.ID.eq(id))
        .fetchOptional(SharedAiMemoryChangeRepository::toRow);
  }

  /** 되돌리기용 잠금(FOR UPDATE) — 같은 기록의 동시 되돌리기를 줄 세운다. */
  public Optional<ChangeRow> lock(long id) {
    return dsl.selectFrom(SHARED_AI_MEMORY_CHANGE)
        .where(SHARED_AI_MEMORY_CHANGE.ID.eq(id))
        .forUpdate()
        .fetchOptional(SharedAiMemoryChangeRepository::toRow);
  }

  /** 되돌림 표시 — 이미 되돌렸으면 0행. */
  public int markUndone(long id, long by, OffsetDateTime at) {
    return dsl.update(SHARED_AI_MEMORY_CHANGE)
        .set(SHARED_AI_MEMORY_CHANGE.UNDONE_AT, at)
        .set(SHARED_AI_MEMORY_CHANGE.UNDONE_BY, by)
        .where(SHARED_AI_MEMORY_CHANGE.ID.eq(id))
        .and(SHARED_AI_MEMORY_CHANGE.UNDONE_AT.isNull())
        .execute();
  }

  /** 보관 기간이 지난 기록을 지운다(테넌트 안 모든 공간 — TenantScopedRunner 트랜잭션에서만) — 지운 수. */
  public int deleteOlderThan(OffsetDateTime cutoff) {
    return dsl.deleteFrom(SHARED_AI_MEMORY_CHANGE)
        .where(SHARED_AI_MEMORY_CHANGE.CREATED_AT.lt(cutoff))
        .execute();
  }

  private static ChangeRow toRow(Record r) {
    JSONB after = r.get(SHARED_AI_MEMORY_CHANGE.AFTER);
    OffsetDateTime undone = r.get(SHARED_AI_MEMORY_CHANGE.UNDONE_AT);
    return new ChangeRow(
        r.get(SHARED_AI_MEMORY_CHANGE.ID),
        r.get(SHARED_AI_MEMORY_CHANGE.SPACE_TYPE),
        r.get(SHARED_AI_MEMORY_CHANGE.SPACE_ID),
        r.get(SHARED_AI_MEMORY_CHANGE.RUN_ID),
        r.get(SHARED_AI_MEMORY_CHANGE.ACTION),
        r.get(SHARED_AI_MEMORY_CHANGE.ACTOR_USER_ID),
        r.get(SHARED_AI_MEMORY_CHANGE.ACTOR_KIND),
        r.get(SHARED_AI_MEMORY_CHANGE.MEMORY_ID),
        r.get(SHARED_AI_MEMORY_CHANGE.BEFORE).data(),
        after == null ? null : after.data(),
        r.get(SHARED_AI_MEMORY_CHANGE.CREATED_AT).toInstant(),
        undone == null ? null : undone.toInstant(),
        r.get(SHARED_AI_MEMORY_CHANGE.UNDONE_BY));
  }
}
