package com.workplace.home.repository;

import static com.workplace.jooq.Tables.AI_MEMORY;
import static com.workplace.jooq.Tables.HOME_MESSAGE;
import static com.workplace.jooq.Tables.HOME_SESSION;

import com.workplace.jooq.tables.records.HomeSessionRecord;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.jooq.Condition;
import org.jooq.DSLContext;
import org.jooq.JSONB;
import org.jooq.impl.DSL;
import org.springframework.stereotype.Repository;

/**
 * 배경 정리용 세션 접근(WP-385 스펙 5.1) — 대상 세션 선정, 경계 뒤 메시지 읽기, 경계·연속 실패 횟수 갱신. 테넌트는 RLS 라 테넌트 트랜잭션 안에서 부른다.
 * 대상 선정만 테넌트 전체(모든 사용자)를 본다 — 나머지는 세션 id 로 좁힌다(세션 소유자는 대상 행의 user_id).
 */
@Repository
@RequiredArgsConstructor
public class AiMemoryCleanupRepository {

  private final DSLContext dsl;

  /** 대상 세션 — processedId 는 지금 경계(NULL = 아직 아무것도 정리 안 함). */
  public record Target(UUID sessionId, long userId, Long processedId) {}

  /**
   * 경계 뒤 메시지 — 정리 입력 재료(위젯·도구 단계는 읽지 않는다, memory 블록만 content_blocks 에서 본다). createdAt 은 DB 시각(구간
   * 마지막 메시지 시각 — 그 뒤에 고친 메모리를 가른다).
   */
  public record Message(
      long id,
      String role,
      String content,
      String status,
      String contentBlocksJson,
      Instant createdAt) {}

  /**
   * 마지막 메시지가 idleBefore 보다 앞이고 notBefore 보다 뒤이며 경계 뒤 메시지가 있는 세션 — 오래된 순 limit 개(스펙: 30분 쉼·7일 안·테넌트당
   * 20).
   */
  public List<Target> findTargets(OffsetDateTime idleBefore, OffsetDateTime notBefore, int limit) {
    var newer =
        DSL.selectOne()
            .from(HOME_MESSAGE)
            .where(HOME_MESSAGE.SESSION_ID.eq(HOME_SESSION.ID))
            .and(
                HOME_SESSION
                    .MEMORY_PROCESSED_MESSAGE_ID
                    .isNull()
                    .or(HOME_MESSAGE.ID.gt(HOME_SESSION.MEMORY_PROCESSED_MESSAGE_ID)));
    return dsl.select(
            HOME_SESSION.ID, HOME_SESSION.USER_ID, HOME_SESSION.MEMORY_PROCESSED_MESSAGE_ID)
        .from(HOME_SESSION)
        .where(HOME_SESSION.LAST_MESSAGE_AT.lt(idleBefore))
        .and(HOME_SESSION.LAST_MESSAGE_AT.gt(notBefore))
        .andExists(newer)
        .orderBy(HOME_SESSION.LAST_MESSAGE_AT.asc(), HOME_SESSION.ID.asc())
        .limit(limit)
        .fetch(r -> new Target(r.value1(), r.value2(), r.value3()));
  }

  /** 경계(afterId, null = 처음부터) 뒤 메시지를 id 순으로 — 경계 비교와 같은 기준(id)으로 정렬한다. */
  public List<Message> newMessages(UUID sessionId, Long afterId) {
    Condition c = HOME_MESSAGE.SESSION_ID.eq(sessionId);
    if (afterId != null) c = c.and(HOME_MESSAGE.ID.gt(afterId));
    return dsl.select(
            HOME_MESSAGE.ID,
            HOME_MESSAGE.ROLE,
            HOME_MESSAGE.CONTENT,
            HOME_MESSAGE.STATUS,
            HOME_MESSAGE.CONTENT_BLOCKS,
            HOME_MESSAGE.CREATED_AT)
        .from(HOME_MESSAGE)
        .where(c)
        .orderBy(HOME_MESSAGE.ID.asc())
        .fetch(
            r -> {
              JSONB blocks = r.value5();
              return new Message(
                  r.value1(),
                  r.value2(),
                  r.value3(),
                  r.value4(),
                  blocks == null ? null : blocks.data(),
                  r.value6() == null ? null : r.value6().toInstant());
            });
  }

  /** 이 대화가 출처인 본인 메모리 id(최신순) — 비교 대상의 "이 대화에서 저장된 메모리". */
  public List<Long> memoryIdsFromSession(long userId, UUID sessionId) {
    return dsl.select(AI_MEMORY.ID)
        .from(AI_MEMORY)
        .where(AI_MEMORY.USER_ID.eq(userId))
        .and(AI_MEMORY.SOURCE_SESSION_ID.eq(sessionId))
        .orderBy(AI_MEMORY.UPDATED_AT.desc(), AI_MEMORY.ID.desc())
        .fetch(AI_MEMORY.ID);
  }

  /**
   * 경계를 uptoId 로 올리고 실패 횟수를 0 으로 — 지금 경계가 expected 일 때만(다른 회차가 먼저 움직였으면 0행). 세션 행을 잠그므로 적용 트랜잭션의 첫
   * 문장으로 부른다.
   */
  public int markProcessed(UUID sessionId, Long expected, long uptoId) {
    return dsl.update(HOME_SESSION)
        .set(HOME_SESSION.MEMORY_PROCESSED_MESSAGE_ID, uptoId)
        .set(HOME_SESSION.MEMORY_CLEANUP_FAILURES, (short) 0)
        .where(HOME_SESSION.ID.eq(sessionId))
        .and(HOME_SESSION.MEMORY_PROCESSED_MESSAGE_ID.isNotDistinctFrom(expected))
        .execute();
  }

  /** 연속 실패 1회 더하고 새 횟수(세션이 없으면 0). */
  public int recordFailure(UUID sessionId) {
    return dsl.update(HOME_SESSION)
        .set(HOME_SESSION.MEMORY_CLEANUP_FAILURES, HOME_SESSION.MEMORY_CLEANUP_FAILURES.plus(1))
        .where(HOME_SESSION.ID.eq(sessionId))
        .returning(HOME_SESSION.MEMORY_CLEANUP_FAILURES)
        .fetchOptional()
        .map(HomeSessionRecord::getMemoryCleanupFailures)
        .map(Short::intValue)
        .orElse(0);
  }

  /** 포기 — 경계를 지금 마지막 메시지로 올리고 실패 횟수를 0 으로(무한 재시도 방지). */
  public int markProcessedToLatest(UUID sessionId) {
    return dsl.update(HOME_SESSION)
        .set(
            HOME_SESSION.MEMORY_PROCESSED_MESSAGE_ID,
            DSL.select(DSL.max(HOME_MESSAGE.ID))
                .from(HOME_MESSAGE)
                .where(HOME_MESSAGE.SESSION_ID.eq(sessionId)))
        .set(HOME_SESSION.MEMORY_CLEANUP_FAILURES, (short) 0)
        .where(HOME_SESSION.ID.eq(sessionId))
        .execute();
  }
}
