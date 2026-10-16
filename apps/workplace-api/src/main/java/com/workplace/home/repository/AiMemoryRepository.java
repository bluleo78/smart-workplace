package com.workplace.home.repository;

import static com.workplace.jooq.Tables.AI_MEMORY;

import com.workplace.jooq.tables.records.AiMemoryRecord;
import java.time.Instant;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.jooq.Condition;
import org.jooq.DSLContext;
import org.jooq.Field;
import org.jooq.Record;
import org.jooq.UpdateSetMoreStep;
import org.jooq.impl.DSL;
import org.springframework.stereotype.Repository;

/**
 * ai_memory 접근(WP-55). <b>모든 쿼리는 user_id 로 거른다</b> — RLS 는 테넌트까지만 막으므로 같은 테넌트의 다른 사용자 행은 여기서 걸러야
 * 한다(IDOR 방지). 테넌트는 RLS(GUC app.tenant_id)가 거르고 insert 의 tenant_id 는 컬럼 DEFAULT(GUC)가 채우므로
 * 반드시 @Transactional 서비스 안에서 부른다.
 *
 * <p>created_at/updated_at 은 DB now()(트랜잭션 시작 시각) 대신 앱 시각을 쓴다 — 한 트랜잭션에서 여러 번 쓰여도 최신순이 뒤집히지 않게.
 *
 * <p>WP-379: scope(null = 공통, 아니면 앱 하나)를 다룬다. 범위 조건은 {@link #inScope} 로만 만든다 — 공통은 {@code IS NULL}
 * 이어야 하는데 {@code eq(null)} 은 아무 행도 맞지 않는 {@code = NULL} 이 될 수 있다.
 *
 * <p>WP-380: expires_on(null = 기한 없음). 한도·주입은 유효 행(기한 없음 또는 오늘 이후)만 센다 — 조건은 {@link #active} 로만
 * 만든다. 정리 배치의 {@link #deleteExpiredBefore} 만 user_id 없이 테넌트 전체(RLS)를 지운다.
 *
 * <p>WP-383: pinned(고정)·search_tv(키워드 색인)·embedding(의미 벡터)이 더해졌다. 행을 읽는 모든 쿼리는 {@link #ROW_FIELDS}
 * 만 고른다 — {@code selectFrom}·인자 없는 {@code returning()} 은 1024차원 벡터와 tsvector 까지 읽어, 설정 목록 한 번에 수천 개
 * 벡터를 직렬화한다.
 */
@Repository
@RequiredArgsConstructor
public class AiMemoryRepository {

  /**
   * 사용자별 생성·복원·범위 이동 직렬화 잠금 classId — 2-인자 pg_advisory_xact_lock(classId, userId). 이슈 번호(55)를
   * 쓴다(81·358·625·758 은 다른 잠금이 사용 중). 상한(범위마다 300·고정 10) 검사와 쓰기 사이에 다른 요청이 끼지 못하게 한다.
   */
  private static final int LOCK_CLASS = 55;

  /** ai_memory.id 시퀀스(BIGSERIAL 기본 이름) — 되살리기가 발급 전 id 를 쓰지 않게 확인한다. */
  private static final String ID_SEQUENCE = "ai_memory_id_seq";

  /** Row 를 만드는 컬럼 — 벡터·tsvector 를 빼고 명시한다(순위 쿼리·테스트 픽스처도 이 목록에 재료 컬럼을 덧붙여 쓴다). */
  public static final List<Field<?>> ROW_FIELDS =
      List.of(
          AI_MEMORY.ID,
          AI_MEMORY.KIND,
          AI_MEMORY.CONTENT,
          AI_MEMORY.SOURCE,
          AI_MEMORY.SOURCE_SESSION_ID,
          AI_MEMORY.CREATED_AT,
          AI_MEMORY.UPDATED_AT,
          AI_MEMORY.SCOPE,
          AI_MEMORY.EXPIRES_ON,
          AI_MEMORY.PINNED,
          AI_MEMORY.LAST_USED_AT);

  private final DSLContext dsl;

  /**
   * 메모리 1건. scope 는 null = 공통(WP-379), expiresOn 은 null = 기한 없음(WP-380), pinned 는 사용자가 설정에서
   * 고정했는가(WP-383), lastUsedAt 은 대화·검색·다른 진입점에 실제로 실린 마지막 시각(WP-385 — 감쇠 기준, 편집으로는 바뀌지 않는다).
   */
  public record Row(
      long id,
      String kind,
      String content,
      String source,
      UUID sourceSessionId,
      Instant createdAt,
      Instant updatedAt,
      String scope,
      LocalDate expiresOn,
      boolean pinned,
      Instant lastUsedAt) {}

  /**
   * 저장할 메모리 1건(id·시각 제외) — insert·insertWithId 가 받는다. sessionId 는 AI 대행 저장의 출처 대화(없으면 null), scope
   * 는 null = 공통(WP-379), expiresOn 은 null = 기한 없음(WP-380). 고정은 늘 꺼진 채(컬럼 DEFAULT) 만든다 — 판정 3.
   */
  public record NewMemory(
      String kind,
      String content,
      String source,
      UUID sessionId,
      String scope,
      LocalDate expiresOn) {}

  /** 사용자 id 가 붙은 행 — 테넌트 전체를 훑는 배치(감쇠 삭제)가 사용자별 기록을 남길 때 쓴다(WP-385). */
  public record Owned(long userId, Row row) {}

  /** 범위 조건 — null 은 공통(IS NULL). 순위 저장소도 같은 규칙을 쓴다. */
  static Condition inScope(String scope) {
    return scope == null ? AI_MEMORY.SCOPE.isNull() : AI_MEMORY.SCOPE.eq(scope);
  }

  /** 유효 조건 — 기한 없음 또는 기한 ≥ 오늘(당일까지 유효). 순위 저장소도 같은 규칙을 쓴다. */
  static Condition active(LocalDate today) {
    return AI_MEMORY.EXPIRES_ON.isNull().or(AI_MEMORY.EXPIRES_ON.ge(today));
  }

  /**
   * 유효 행 전부(범위 무관) 최신순 — 설정 목록용. 범위마다 상한(300)이 유효 행만 세므로 개수는 범위 수 × 300 이하다. 만료 행과 상한을 나눠 쓰지 않아 만료
   * 행이 아무리 많아도 유효 행이 목록에서 빠지지 않는다.
   */
  public List<Row> listActive(long userId, LocalDate today) {
    return dsl.select(ROW_FIELDS)
        .from(AI_MEMORY)
        .where(AI_MEMORY.USER_ID.eq(userId))
        .and(active(today))
        .orderBy(AI_MEMORY.UPDATED_AT.desc(), AI_MEMORY.ID.desc())
        .fetch(AiMemoryRepository::toRow);
  }

  /** 만료 행(기한 &lt; 오늘) 최신순 최대 limit 건 — 설정 목록용. 만료 행은 한도가 없어 상한을 둔다. */
  public List<Row> listExpired(long userId, LocalDate today, int limit) {
    return dsl.select(ROW_FIELDS)
        .from(AI_MEMORY)
        .where(AI_MEMORY.USER_ID.eq(userId))
        .and(AI_MEMORY.EXPIRES_ON.lt(today))
        .orderBy(AI_MEMORY.UPDATED_AT.desc(), AI_MEMORY.ID.desc())
        .limit(limit)
        .fetch(AiMemoryRepository::toRow);
  }

  /** 행 잠금 조회 — 고치기 전 이전 값을 정확히 돌려주기 위해(동시 고치기 직렬화). */
  public Optional<Row> lock(long userId, long id) {
    return dsl.select(ROW_FIELDS)
        .from(AI_MEMORY)
        .where(AI_MEMORY.ID.eq(id))
        .and(AI_MEMORY.USER_ID.eq(userId))
        .forUpdate()
        .fetchOptional(AiMemoryRepository::toRow);
  }

  /**
   * 한 범위(null = 공통)의 유효 메모리 개수 — 범위마다 상한(300) 검사용(인덱스 ai_memory_user_scope_idx). 만료 행은 세지
   * 않는다(WP-380).
   */
  public int countInScope(long userId, String scope, LocalDate today) {
    return dsl.fetchCount(
        AI_MEMORY, AI_MEMORY.USER_ID.eq(userId).and(inScope(scope)).and(active(today)));
  }

  /**
   * 한 범위(null = 공통)의 고정 행 수 — <b>만료 행 포함</b>(판정 1: 만료 행 되살리기가 고정 상한을 넘기는 경로를 없앤다). 고정 상한(10) 검사용.
   */
  public int countPinnedInScope(long userId, String scope) {
    return dsl.fetchCount(
        AI_MEMORY, AI_MEMORY.USER_ID.eq(userId).and(inScope(scope)).and(AI_MEMORY.PINNED.isTrue()));
  }

  /**
   * 채팅 후보(WP-383) — 범위 필터(공통 + 지금 앱)의 유효 행 최신순 전부. 범위마다 300 이하라 많아야 600 행이고, 벡터·tsvector 는 읽지 않는다.
   * 순서는 30줄 이하일 때의 주입 순서·빈 질의의 최신 순위다.
   */
  public List<Row> listCandidates(long userId, ScopeFilter filter, LocalDate today) {
    return dsl.select(ROW_FIELDS)
        .from(AI_MEMORY)
        .where(AI_MEMORY.USER_ID.eq(userId))
        .and(filter.condition())
        .and(active(today))
        .orderBy(AI_MEMORY.UPDATED_AT.desc(), AI_MEMORY.ID.desc())
        .fetch(AiMemoryRepository::toRow);
  }

  /** 지정한 본인 유효 메모리(WP-385 — 이 대화가 저장·수정한 비교 대상) 최신순. ids 가 비면 빈 목록. */
  public List<Row> findActiveByIds(long userId, Collection<Long> ids, LocalDate today) {
    if (ids.isEmpty()) return List.of();
    return dsl.select(ROW_FIELDS)
        .from(AI_MEMORY)
        .where(AI_MEMORY.USER_ID.eq(userId))
        .and(AI_MEMORY.ID.in(ids))
        .and(active(today))
        .orderBy(AI_MEMORY.UPDATED_AT.desc(), AI_MEMORY.ID.desc())
        .fetch(AiMemoryRepository::toRow);
  }

  /**
   * 채팅 후보 수(WP-383) — listCandidates 와 같은 조건. 많으면 행을 읽지 않고 순위 재료(AiMemoryRankRepository.score)로 바로
   * 간다.
   */
  public int countCandidates(long userId, ScopeFilter filter, LocalDate today) {
    return dsl.fetchCount(
        AI_MEMORY, AI_MEMORY.USER_ID.eq(userId).and(filter.condition()).and(active(today)));
  }

  /** 유효 메모리 수(범위 무관, WP-383) — 블록에 넣지 않은 수("더 있음", 다른 범위 포함)를 센다. */
  public int countActive(long userId, LocalDate today) {
    return dsl.fetchCount(AI_MEMORY, AI_MEMORY.USER_ID.eq(userId).and(active(today)));
  }

  /** 이 사용자의 생성·복원·범위 이동·고정을 트랜잭션 끝까지 직렬화한다(자동 해제). */
  public void lockUser(long userId) {
    // 2-int 잠금 키라 user id 를 int 로 접는다 — 21억을 넘는 id 가 다른 사용자와 겹쳐도 같은 잠금을 잠깐 나눠 쓸 뿐(직렬화가 넓어질 뿐 정합성은
    // 같다).
    dsl.execute("SELECT pg_advisory_xact_lock(?, ?)", LOCK_CLASS, (int) userId);
  }

  /** 메모리 1건 저장 후 저장된 행을 돌려준다(상한·기한 검사는 호출자가 잠금 안에서 한다). */
  public Row insert(long userId, NewMemory m) {
    return toRow(
        dsl.insertInto(AI_MEMORY).set(newRecord(userId, m)).returning(ROW_FIELDS).fetchOne());
  }

  /**
   * 지정한 id 로 1건 저장(되돌리기의 되살리기 — 원래 id 유지). 그 id 가 이미 있거나(ON CONFLICT DO NOTHING — 예외로 트랜잭션을 깨지 않는다)
   * 시퀀스가 아직 발급하지 않은 값이면 empty 를 돌려 호출자가 새 id 로 만들게 한다. 발급 전 값을 넣으면 나중에 시퀀스가 그 값에 닿을 때 일반 저장이 키 충돌로
   * 실패하므로 막는다.
   */
  public Optional<Row> insertWithId(long id, long userId, NewMemory m) {
    if (id <= 0 || id > lastIssued(dsl, ID_SEQUENCE)) return Optional.empty();
    AiMemoryRecord r = newRecord(userId, m);
    r.setId(id);
    return dsl.insertInto(AI_MEMORY)
        .set(r)
        .onConflict(AI_MEMORY.ID)
        .doNothing()
        .returning(ROW_FIELDS)
        .fetchOptional()
        .map(AiMemoryRepository::toRow);
  }

  /**
   * 시퀀스가 지금까지 발급한 가장 큰 값(아직 하나도 발급하지 않았으면 last_value - 1). nextval 전의 새 시퀀스는 last_value 가 시작값(1)이지만
   * is_called 가 false 라 1 은 아직 발급되지 않았다 — last_value 만 보면 1 을 발급된 값으로 오인해 되살리기가 다음 일반 저장과 충돌한다.
   */
  static long lastIssued(DSLContext dsl, String sequence) {
    Long v =
        dsl.resultQuery(
                "SELECT CASE WHEN is_called THEN last_value ELSE last_value - 1 END FROM {0}",
                DSL.name(sequence))
            .fetchOne(0, Long.class);
    return v == null ? 0 : v;
  }

  /**
   * 저장할 값만 채운 레코드 — insert·insertWithId 공용. 채운 필드만 INSERT 에 실리므로(changed 플래그) tenant_id 는 컬럼
   * DEFAULT(GUC)가, pinned 는 DEFAULT false 가 채운다. scope·expiresOn 은 null 이어도 명시적으로 넣는다(공통·기한 없음).
   */
  private AiMemoryRecord newRecord(long userId, NewMemory m) {
    OffsetDateTime now = OffsetDateTime.now(ZoneOffset.UTC);
    AiMemoryRecord r = dsl.newRecord(AI_MEMORY);
    r.setUserId(userId);
    r.setKind(m.kind());
    r.setContent(m.content());
    r.setSource(m.source());
    r.setSourceSessionId(m.sessionId());
    r.setScope(m.scope());
    r.setExpiresOn(m.expiresOn());
    r.setCreatedAt(now);
    r.setUpdatedAt(now);
    // WP-385: 새로 만든 메모리는 지금 쓰인 것으로 본다(만든 직후 감쇠 대상이 되지 않게) — created_at 과 같은 앱 시각.
    r.setLastUsedAt(now);
    return r;
  }

  /** 내용이 바뀌면 임베딩을 같은 UPDATE 에서 비우는 식(WP-383) — SET 안의 content 는 바꾸기 전 값이다. */
  private static Field<Object> keepEmbeddingIfSame(String content) {
    return keepEmbeddingIfSame(AI_MEMORY.CONTENT, AI_MEMORY.EMBEDDING, content);
  }

  /** 표·컬럼을 받는 같은 식 — 공용 메모리 저장소(WP-386)도 쓴다. */
  static Field<Object> keepEmbeddingIfSame(
      Field<String> contentField, Field<?> embeddingField, String content) {
    return DSL.field(
        "CASE WHEN {0} IS DISTINCT FROM {1} THEN NULL ELSE {2} END",
        Object.class, contentField, DSL.val(content), embeddingField);
  }

  /**
   * 종류·내용·범위·기한 SET 과 수정 시각(updatedAt) — 고치기·배경 정리 공용. 내용이 바뀌면 임베딩을 같은 UPDATE 에서 비운다(WP-383 — SET
   * 안의 content 는 바꾸기 전 값이라 범위·기한·종류만 바꾸면 그대로 둔다).
   */
  private UpdateSetMoreStep<AiMemoryRecord> setContent(
      String kind, String content, String scope, LocalDate expiresOn, OffsetDateTime updatedAt) {
    return dsl.update(AI_MEMORY)
        .set(AI_MEMORY.KIND, kind)
        .set(AI_MEMORY.CONTENT, content)
        .set(AI_MEMORY.SCOPE, scope)
        .set(AI_MEMORY.EXPIRES_ON, expiresOn)
        .set(Map.<Field<?>, Object>of(AI_MEMORY.EMBEDDING, keepEmbeddingIfSame(content)))
        .set(AI_MEMORY.UPDATED_AT, updatedAt);
  }

  /** 본인 행 하나에 UPDATE 를 걸고 바뀐 행을 돌려준다 — 없거나 남의 것이면 empty. */
  private Optional<Row> updateOwn(UpdateSetMoreStep<AiMemoryRecord> set, long userId, long id) {
    return set.where(AI_MEMORY.ID.eq(id))
        .and(AI_MEMORY.USER_ID.eq(userId))
        .returning(ROW_FIELDS)
        .fetchOptional()
        .map(AiMemoryRepository::toRow);
  }

  /** 종류·내용·범위·기한을 바꾸고 맨 위로 올린다(updated_at 갱신) — 없거나 남의 것이면 empty. */
  public Optional<Row> update(
      long userId, long id, String kind, String content, String scope, LocalDate expiresOn) {
    return updateOwn(
        setContent(kind, content, scope, expiresOn, OffsetDateTime.now(ZoneOffset.UTC)),
        userId,
        id);
  }

  /**
   * 배경 정리의 고치기·합치기 결과(WP-385 스펙 5.5) — 종류·내용·범위·기한을 바꾸고 출처 대화를 이 대화로, 수정·사용 시각을 at 으로 둔다(정리 결과는 방금
   * 쓰인 것으로 본다). 내용이 바뀌면 임베딩을 비운다. 없거나 남의 것이면 empty.
   */
  public Optional<Row> applyCleanup(
      long userId,
      long id,
      String kind,
      String content,
      String scope,
      LocalDate expiresOn,
      UUID sessionId,
      OffsetDateTime at) {
    return updateOwn(
        setContent(kind, content, scope, expiresOn, at)
            .set(AI_MEMORY.SOURCE_SESSION_ID, sessionId)
            .set(AI_MEMORY.LAST_USED_AT, at),
        userId,
        id);
  }

  /** 고정 켜기·끄기(WP-383) — updated_at·임베딩은 그대로 둔다(고정 토글이 최신 순위를 바꾸지 않게, 판정 2). 없거나 남의 것이면 empty. */
  public Optional<Row> setPinned(long userId, long id, boolean pinned) {
    return dsl.update(AI_MEMORY)
        .set(AI_MEMORY.PINNED, pinned)
        .where(AI_MEMORY.ID.eq(id))
        .and(AI_MEMORY.USER_ID.eq(userId))
        .returning(ROW_FIELDS)
        .fetchOptional()
        .map(AiMemoryRepository::toRow);
  }

  /**
   * 사용 시각 갱신(WP-385) — ids 중 사용 시각이 staleBefore 보다 오래된 행만 now 로 올린다(같은 시간대 반복 쓰기 생략).
   * updated_at·임베딩은 건드리지 않는다(사용은 편집이 아니다). 본인 행만 고치고(user_id 조건), 테넌트는 RLS 가 거른다. 고친 행 수.
   */
  public int touchUsed(
      long userId, Collection<Long> ids, OffsetDateTime now, OffsetDateTime staleBefore) {
    if (ids.isEmpty()) return 0;
    return dsl.update(AI_MEMORY)
        .set(AI_MEMORY.LAST_USED_AT, now)
        .where(AI_MEMORY.ID.in(ids))
        .and(AI_MEMORY.USER_ID.eq(userId))
        .and(AI_MEMORY.LAST_USED_AT.lt(staleBefore))
        .execute();
  }

  /** 지운 행(없으면 empty) — 응답·도구 결과가 지운 kind·content·source·scope 를 돌려준다. */
  public Optional<Row> delete(long userId, long id) {
    return dsl.deleteFrom(AI_MEMORY)
        .where(AI_MEMORY.ID.eq(id))
        .and(AI_MEMORY.USER_ID.eq(userId))
        .returning(ROW_FIELDS)
        .fetchOptional()
        .map(AiMemoryRepository::toRow);
  }

  /** 본인 메모리 여러 건을 한 번에 지운다(WP-385 — 합치기의 나머지 대상) — 지운 수. 남의 id 는 지우지 않는다. */
  public int deleteByIds(long userId, Collection<Long> ids) {
    if (ids.isEmpty()) return 0;
    return dsl.deleteFrom(AI_MEMORY)
        .where(AI_MEMORY.ID.in(ids))
        .and(AI_MEMORY.USER_ID.eq(userId))
        .execute();
  }

  /** 본인 메모리를 모두 지우고 지운 내용을 돌려준다(WP-385 — 지운 기록에 남긴다). 순서는 정하지 않는다. */
  public List<String> deleteAllContents(long userId) {
    return dsl.deleteFrom(AI_MEMORY)
        .where(AI_MEMORY.USER_ID.eq(userId))
        .returning(AI_MEMORY.CONTENT)
        .fetch(AI_MEMORY.CONTENT);
  }

  /**
   * 정리 배치(WP-380) — 기한이 cutoff 보다 앞선 행을 지운다(테넌트 안 모든 사용자). 테넌트는 RLS(GUC)가 거르므로 TenantScopedRunner
   * 트랜잭션 안에서만 부른다. 부분 인덱스 ai_memory_expires_idx 를 탄다.
   */
  public int deleteExpiredBefore(LocalDate cutoff) {
    return dsl.deleteFrom(AI_MEMORY).where(AI_MEMORY.EXPIRES_ON.lt(cutoff)).execute();
  }

  /**
   * 감쇠 삭제(WP-385 스펙 7) — AI 저장 + 고정 아님 + 사용 시각이 cutoff 보다 앞선 행을 지우고 지운 행을 사용자 id 와 함께 돌려준다(DECAYED
   * 기록용). 테넌트 안 모든 사용자 — TenantScopedRunner 트랜잭션 안에서만 부른다. 부분 인덱스 ai_memory_last_used_idx 를 탄다.
   */
  public List<Owned> deleteDecayed(OffsetDateTime cutoff) {
    List<Field<?>> fields = new ArrayList<>(ROW_FIELDS);
    fields.add(AI_MEMORY.USER_ID);
    return dsl.deleteFrom(AI_MEMORY)
        .where(AI_MEMORY.SOURCE.eq("AI"))
        .and(AI_MEMORY.PINNED.isFalse())
        .and(AI_MEMORY.LAST_USED_AT.lt(cutoff))
        .returning(fields)
        .fetch(r -> new Owned(r.get(AI_MEMORY.USER_ID), toRow(r)));
  }

  /** {@link #ROW_FIELDS} 를 고른 레코드 → Row — 순위 쿼리·테스트 픽스처도 같은 변환을 쓴다. */
  public static Row toRow(Record r) {
    return new Row(
        r.get(AI_MEMORY.ID),
        r.get(AI_MEMORY.KIND),
        r.get(AI_MEMORY.CONTENT),
        r.get(AI_MEMORY.SOURCE),
        r.get(AI_MEMORY.SOURCE_SESSION_ID),
        r.get(AI_MEMORY.CREATED_AT).toInstant(),
        r.get(AI_MEMORY.UPDATED_AT).toInstant(),
        r.get(AI_MEMORY.SCOPE),
        r.get(AI_MEMORY.EXPIRES_ON),
        Boolean.TRUE.equals(r.get(AI_MEMORY.PINNED)),
        r.get(AI_MEMORY.LAST_USED_AT).toInstant());
  }
}
