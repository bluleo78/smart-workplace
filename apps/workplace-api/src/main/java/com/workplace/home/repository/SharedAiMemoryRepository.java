package com.workplace.home.repository;

import static com.workplace.jooq.Tables.SHARED_AI_MEMORY;
import static com.workplace.jooq.Tables.SHARED_AI_MEMORY_CHANGE;
import static com.workplace.jooq.Tables.SHARED_AI_MEMORY_FORGOTTEN;
import static com.workplace.jooq.Tables.USER;

import com.workplace.global.tenant.TenantContext;
import com.workplace.home.repository.AiMemoryRankRepository.RankColumns;
import com.workplace.home.service.RrfRanking;
import com.workplace.home.service.SharedMemorySnapshot;
import com.workplace.home.service.SharedSpace.SpaceKey;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.jooq.Condition;
import org.jooq.DSLContext;
import org.jooq.Field;
import org.jooq.Record;
import org.jooq.impl.DSL;
import org.springframework.stereotype.Repository;

/**
 * 공용 AI 메모리 저장소(WP-386). <b>모든 쿼리는 공간 키(space_type, space_id)로 거른다</b> — RLS 는 테넌트까지만 막는다. 테넌트는
 * RLS(GUC)·tenant_id DEFAULT 가 정하므로 테넌트 트랜잭션 안에서 부른다. 벡터·tsvector 는 행에 싣지 않는다(ROW_FIELDS).
 *
 * <p>공간 잠금은 트랜잭션 범위 advisory lock — 한도(50)·사람 편집·배경 정리·되돌리기가 한 공간에서 겹치지 않게 한다. 잠금 순서는 (세션 행 → 사용자
 * 잠금 →) 공간 잠금 → 메모리·기록 행이다. 시각은 앱이 밀리초로 잘라 넣는다 — 키셋 커서(CursorCodec)가 밀리초라 마이크로초가 남으면 페이지 경계에서 행이
 * 빠진다(WP-385 와 같은 규칙).
 */
@Repository
@RequiredArgsConstructor
public class SharedAiMemoryRepository {

  /** 공간당 상한(스펙 3절). */
  public static final int SPACE_LIMIT = 50;

  /** 조직 상한. */
  public static final int ORG_LIMIT = 30;

  /** 내용 상한(코드포인트) — DB VARCHAR(300). */
  public static final int MAX_CHARS = 300;

  /**
   * advisory lock 클래스 — 조직 3860(키 = 테넌트 id)·프로젝트 3861·스페이스 3862(키 = 공간 id). 쓰이는
   * 클래스(55·81·358·625·758)와 겹치지 않는다. 조직 키에 테넌트를 넣어 다른 테넌트의 조직 변경끼리 줄 서지 않게 한다(공간 id 는 전역 유일이라 테넌트가
   * 이미 갈린다).
   */
  private static final int LOCK_ORG = 3860;

  private static final int LOCK_PROJECT = 3861;
  private static final int LOCK_WIKI = 3862;

  /** shared_ai_memory.id 시퀀스(BIGSERIAL 기본 이름) — 되살리기가 발급 전 id 를 쓰지 않게 확인한다. */
  private static final String ID_SEQUENCE = "shared_ai_memory_id_seq";

  private static final List<Field<?>> ROW_FIELDS =
      List.of(
          SHARED_AI_MEMORY.ID,
          SHARED_AI_MEMORY.SPACE_TYPE,
          SHARED_AI_MEMORY.SPACE_ID,
          SHARED_AI_MEMORY.CONTENT,
          SHARED_AI_MEMORY.ORIGIN,
          SHARED_AI_MEMORY.AUTHOR_USER_ID,
          SHARED_AI_MEMORY.CREATED_AT,
          SHARED_AI_MEMORY.UPDATED_AT,
          SHARED_AI_MEMORY.UPDATED_BY);

  private final DSLContext dsl;

  /** 공용 메모리 1건 — authorUserId 는 직접 추가·요청한 사람(AI 항목은 null), updatedBy 는 마지막으로 바꾼 사람(AI 면 null). */
  public record Row(
      long id,
      String spaceType,
      Long spaceId,
      String content,
      String origin,
      Long authorUserId,
      Instant createdAt,
      Instant updatedAt,
      Long updatedBy) {

    /** 이 행의 공간 키. */
    public SpaceKey spaceKey() {
      return SpaceKey.of(spaceType, spaceId);
    }
  }

  /** 검색 순위 재료(AiMemoryRankRepository.Scored 와 같은 뜻). */
  public record Scored(Row row, boolean ftsMatch, double ftsRank, int termHits, Double distance)
      implements RrfRanking.Material {}

  /** 공간 상한 — 조직 30, 그 밖 50. */
  public static int limitOf(SpaceKey k) {
    return "ORG".equals(k.type()) ? ORG_LIMIT : SPACE_LIMIT;
  }

  /**
   * 공간 조건 — 공용 메모리·기록·지운 기록 세 표가 같은 규칙을 쓴다. 조직은 space_id IS NULL 이어야 한다({@code eq(null)} 은 아무 행도 맞지
   * 않는 {@code = NULL} 이 될 수 있다).
   */
  static Condition inSpace(Field<String> typeField, Field<Long> idField, SpaceKey k) {
    Condition t = typeField.eq(k.type());
    return k.id() == null ? t.and(idField.isNull()) : t.and(idField.eq(k.id()));
  }

  private static Condition space(SpaceKey k) {
    return inSpace(SHARED_AI_MEMORY.SPACE_TYPE, SHARED_AI_MEMORY.SPACE_ID, k);
  }

  /** 앱 시각을 밀리초로 자른다 — 키셋 커서가 밀리초라서. */
  private static OffsetDateTime ms(OffsetDateTime at) {
    return at.truncatedTo(ChronoUnit.MILLIS);
  }

  /** 공간 잠금(트랜잭션 범위, 같은 트랜잭션에서 여러 번 잡아도 된다). */
  public void lockSpace(SpaceKey k) {
    int cls;
    long key;
    switch (k.type()) {
      case "ORG" -> {
        cls = LOCK_ORG;
        key = TenantContext.require();
      }
      case "PROJECT" -> {
        cls = LOCK_PROJECT;
        key = k.id();
      }
      default -> {
        cls = LOCK_WIKI;
        key = k.id();
      }
    }
    // 2-int 잠금 키라 id 를 int 로 접는다 — 21억을 넘는 id 가 겹쳐도 같은 잠금을 잠깐 나눠 쓸 뿐(직렬화가 넓어질 뿐 정합성은 같다).
    dsl.execute("SELECT pg_advisory_xact_lock(?, ?)", cls, (int) key);
  }

  /** 새 메모리. */
  public Row insert(
      SpaceKey k,
      String content,
      String origin,
      Long authorUserId,
      Long updatedBy,
      OffsetDateTime at) {
    OffsetDateTime t = ms(at);
    return dsl.insertInto(SHARED_AI_MEMORY)
        .set(SHARED_AI_MEMORY.SPACE_TYPE, k.type())
        .set(SHARED_AI_MEMORY.SPACE_ID, k.id())
        .set(SHARED_AI_MEMORY.CONTENT, content)
        .set(SHARED_AI_MEMORY.ORIGIN, origin)
        .set(SHARED_AI_MEMORY.AUTHOR_USER_ID, authorUserId)
        .set(SHARED_AI_MEMORY.CREATED_AT, t)
        .set(SHARED_AI_MEMORY.UPDATED_AT, t)
        .set(SHARED_AI_MEMORY.UPDATED_BY, updatedBy)
        .returningResult(ROW_FIELDS)
        .fetchOne(SharedAiMemoryRepository::toRow);
  }

  /**
   * 원래 id 로 되살림(되돌리기) — id 가 이미 쓰였거나(ON CONFLICT DO NOTHING — 예외로 트랜잭션을 깨지 않는다) 시퀀스가 아직 발급하지 않은 값이면
   * empty. 발급 전 값을 넣으면 나중에 시퀀스가 그 값에 닿을 때 일반 저장이 키 충돌로 실패하므로 막는다(개인 메모리 insertWithId 와 같은 규칙).
   */
  public Optional<Row> insertWithId(
      long id, SpaceKey k, SharedMemorySnapshot s, Long updatedBy, OffsetDateTime at) {
    if (id <= 0 || id > AiMemoryRepository.lastIssued(dsl, ID_SEQUENCE)) return Optional.empty();
    OffsetDateTime t = ms(at);
    return dsl.insertInto(SHARED_AI_MEMORY)
        .set(SHARED_AI_MEMORY.ID, id)
        .set(SHARED_AI_MEMORY.SPACE_TYPE, k.type())
        .set(SHARED_AI_MEMORY.SPACE_ID, k.id())
        .set(SHARED_AI_MEMORY.CONTENT, s.content())
        .set(SHARED_AI_MEMORY.ORIGIN, s.origin())
        .set(SHARED_AI_MEMORY.AUTHOR_USER_ID, s.authorUserId())
        .set(SHARED_AI_MEMORY.CREATED_AT, t)
        .set(SHARED_AI_MEMORY.UPDATED_AT, t)
        .set(SHARED_AI_MEMORY.UPDATED_BY, updatedBy)
        .onConflictDoNothing()
        .returningResult(ROW_FIELDS)
        .fetchOptional(SharedAiMemoryRepository::toRow);
  }

  /** 공간 안의 한 건. */
  public Optional<Row> find(SpaceKey k, long id) {
    return dsl.select(ROW_FIELDS)
        .from(SHARED_AI_MEMORY)
        .where(space(k))
        .and(SHARED_AI_MEMORY.ID.eq(id))
        .fetchOptional(SharedAiMemoryRepository::toRow);
  }

  /** 공간 안의 한 건을 잠근다(FOR UPDATE) — 같은 행의 동시 고치기를 줄 세운다. */
  public Optional<Row> lock(SpaceKey k, long id) {
    return dsl.select(ROW_FIELDS)
        .from(SHARED_AI_MEMORY)
        .where(space(k))
        .and(SHARED_AI_MEMORY.ID.eq(id))
        .forUpdate()
        .fetchOptional(SharedAiMemoryRepository::toRow);
  }

  /**
   * id 로 한 건(공간 무관) — PATCH·DELETE 가 행의 공간을 알아내 권한을 본다. 잠금이 필요하면 공간 잠금 뒤 {@link #lock} 으로 다시 읽는다.
   */
  public Optional<Row> findById(long id) {
    return dsl.select(ROW_FIELDS)
        .from(SHARED_AI_MEMORY)
        .where(SHARED_AI_MEMORY.ID.eq(id))
        .fetchOptional(SharedAiMemoryRepository::toRow);
  }

  /** id 들로 한꺼번에(공간 무관) — 기록 목록이 「지금 되돌릴 수 있는가」를 한 번에 판정할 때 쓴다(WP-609). */
  public Map<Long, Row> findByIds(Collection<Long> ids) {
    if (ids.isEmpty()) return Map.of();
    return dsl.select(ROW_FIELDS)
        .from(SHARED_AI_MEMORY)
        .where(SHARED_AI_MEMORY.ID.in(ids))
        .fetchMap(SHARED_AI_MEMORY.ID, SharedAiMemoryRepository::toRow);
  }

  /** 내용·출처·수정자 갱신 — 내용이 바뀌면 같은 UPDATE 에서 임베딩을 비운다(백필·커밋 뒤 채움). 없는 id 면 null. */
  public Row update(long id, String content, String origin, Long updatedBy, OffsetDateTime at) {
    return dsl.update(SHARED_AI_MEMORY)
        .set(
            Map.<Field<?>, Object>of(
                SHARED_AI_MEMORY.EMBEDDING,
                AiMemoryRepository.keepEmbeddingIfSame(
                    SHARED_AI_MEMORY.CONTENT, SHARED_AI_MEMORY.EMBEDDING, content)))
        .set(SHARED_AI_MEMORY.CONTENT, content)
        .set(SHARED_AI_MEMORY.ORIGIN, origin)
        .set(SHARED_AI_MEMORY.UPDATED_BY, updatedBy)
        .set(SHARED_AI_MEMORY.UPDATED_AT, ms(at))
        .where(SHARED_AI_MEMORY.ID.eq(id))
        .returningResult(ROW_FIELDS)
        .fetchOne(SharedAiMemoryRepository::toRow);
  }

  /** 지운다 — 지운 행 수. */
  public int delete(long id) {
    return dsl.deleteFrom(SHARED_AI_MEMORY).where(SHARED_AI_MEMORY.ID.eq(id)).execute();
  }

  /** 공간 개수. */
  public int count(SpaceKey k) {
    return dsl.fetchCount(SHARED_AI_MEMORY, space(k));
  }

  /** 공간 전부(updated_at DESC, id DESC) — 공간당 ≤50 이라 주입·추출 비교에 그대로 쓴다. */
  public List<Row> all(SpaceKey k) {
    return dsl.select(ROW_FIELDS)
        .from(SHARED_AI_MEMORY)
        .where(space(k))
        .orderBy(SHARED_AI_MEMORY.UPDATED_AT.desc(), SHARED_AI_MEMORY.ID.desc())
        .fetch(SharedAiMemoryRepository::toRow);
  }

  /** 키셋 한 묶음 — 커서(updatedAt·id) 다음부터. 커서 id 가 숫자가 아니면 첫 페이지(변조 커서 500 방어). */
  public List<Row> page(SpaceKey k, CursorCodec.Decoded cursor, int limit) {
    Condition where = space(k);
    Long cursorId = cursor == null ? null : cursor.longId();
    if (cursorId != null) {
      where =
          where.and(
              DSL.row(SHARED_AI_MEMORY.UPDATED_AT, SHARED_AI_MEMORY.ID)
                  .lessThan(
                      OffsetDateTime.ofInstant(cursor.createdAt(), ZoneOffset.UTC), cursorId));
    }
    return dsl.select(ROW_FIELDS)
        .from(SHARED_AI_MEMORY)
        .where(where)
        .orderBy(SHARED_AI_MEMORY.UPDATED_AT.desc(), SHARED_AI_MEMORY.ID.desc())
        .limit(limit)
        .fetch(SharedAiMemoryRepository::toRow);
  }

  /** 공간 행마다 검색 순위 재료(개인 AiMemoryRankRepository#score 와 같은 식). vec 이 null 이면 의미 재료를 뺀다. */
  public List<Scored> score(SpaceKey k, String query, List<String> terms, float[] vec) {
    RankColumns c =
        RankColumns.of(
            SHARED_AI_MEMORY.SEARCH_TV,
            SHARED_AI_MEMORY.CONTENT,
            SHARED_AI_MEMORY.EMBEDDING,
            query,
            terms,
            vec);
    List<Field<?>> fields = new ArrayList<>(ROW_FIELDS);
    fields.addAll(c.asList());
    return dsl.select(fields)
        .from(SHARED_AI_MEMORY)
        .where(space(k))
        .fetch(r -> c.read(r, SharedAiMemoryRepository::toRow, Scored::new));
  }

  /** 공간별 개수 — 키 `ORG`·`PROJECT:12`. */
  public Map<String, Integer> countsByParam() {
    Map<String, Integer> out = new LinkedHashMap<>();
    dsl.select(SHARED_AI_MEMORY.SPACE_TYPE, SHARED_AI_MEMORY.SPACE_ID, DSL.count())
        .from(SHARED_AI_MEMORY)
        .groupBy(SHARED_AI_MEMORY.SPACE_TYPE, SHARED_AI_MEMORY.SPACE_ID)
        .forEach(
            r -> {
              SpaceKey k = SpaceKey.of(r.value1(), r.value2());
              if (k != null) out.put(k.param(), r.value3());
            });
    return out;
  }

  /** 공간을 통째로 지운다(프로젝트 삭제) — 메모리·기록·지운 기록. */
  public void deleteSpace(SpaceKey k) {
    dsl.deleteFrom(SHARED_AI_MEMORY).where(space(k)).execute();
    dsl.deleteFrom(SHARED_AI_MEMORY_CHANGE)
        .where(inSpace(SHARED_AI_MEMORY_CHANGE.SPACE_TYPE, SHARED_AI_MEMORY_CHANGE.SPACE_ID, k))
        .execute();
    dsl.deleteFrom(SHARED_AI_MEMORY_FORGOTTEN)
        .where(
            inSpace(SHARED_AI_MEMORY_FORGOTTEN.SPACE_TYPE, SHARED_AI_MEMORY_FORGOTTEN.SPACE_ID, k))
        .execute();
  }

  /** 사용자 이름(전역 "user" 표) — 행 메타·기록 행위자 표시. */
  public Map<Long, String> userNames(Collection<Long> ids) {
    if (ids.isEmpty()) return Map.of();
    return dsl.select(USER.ID, USER.NAME)
        .from(USER)
        .where(USER.ID.in(ids))
        .fetchMap(USER.ID, USER.NAME);
  }

  private static Row toRow(Record r) {
    return new Row(
        r.get(SHARED_AI_MEMORY.ID),
        r.get(SHARED_AI_MEMORY.SPACE_TYPE),
        r.get(SHARED_AI_MEMORY.SPACE_ID),
        r.get(SHARED_AI_MEMORY.CONTENT),
        r.get(SHARED_AI_MEMORY.ORIGIN),
        r.get(SHARED_AI_MEMORY.AUTHOR_USER_ID),
        r.get(SHARED_AI_MEMORY.CREATED_AT).toInstant(),
        r.get(SHARED_AI_MEMORY.UPDATED_AT).toInstant(),
        r.get(SHARED_AI_MEMORY.UPDATED_BY));
  }
}
