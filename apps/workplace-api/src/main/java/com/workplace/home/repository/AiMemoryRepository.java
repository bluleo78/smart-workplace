package com.workplace.home.repository;

import static com.workplace.jooq.Tables.AI_MEMORY;

import com.workplace.jooq.tables.records.AiMemoryRecord;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
import org.jooq.impl.DSL;
import org.springframework.stereotype.Repository;

/**
 * ai_memory 접근(WP-55). <b>모든 쿼리는 user_id 로 거른다</b> — RLS 는 테넌트까지만 막으므로 같은 테넌트의 다른 사용자 행은 여기서 걸러야
 * 한다(IDOR 방지). 테넌트는 RLS(GUC app.tenant_id)가 거르고 insert 의 tenant_id 는 컬럼 DEFAULT(GUC)가 채우므로
 * 반드시 @Transactional 서비스 안에서 부른다.
 *
 * <p>created_at/updated_at 은 DB now()(트랜잭션 시작 시각) 대신 앱 시각을 쓴다 — 한 트랜잭션에서 여러 번 쓰여도 최신순이 뒤집히지 않게.
 */
@Repository
@RequiredArgsConstructor
public class AiMemoryRepository {

  /**
   * 사용자별 생성·복원 직렬화 잠금 classId — 2-인자 pg_advisory_xact_lock(classId, userId). 이슈 번호(55)를
   * 쓴다(81·358·625·758 은 다른 잠금이 사용 중). 상한(50) 검사와 insert 사이에 다른 요청이 끼지 못하게 한다.
   */
  private static final int LOCK_CLASS = 55;

  /** ai_memory.id 시퀀스(BIGSERIAL 기본 이름) — 되살리기가 발급 전 id 를 쓰지 않게 확인한다. */
  private static final String ID_SEQUENCE = "ai_memory_id_seq";

  private final DSLContext dsl;

  /** 메모리 1건. */
  public record Row(
      long id,
      String kind,
      String content,
      String source,
      UUID sourceSessionId,
      Instant createdAt,
      Instant updatedAt) {}

  /** updated_at 최신순(같으면 id 큰 것 먼저) 최대 limit 건 — 설정 목록·채팅 주입 공용(인덱스 ai_memory_user_idx). */
  public List<Row> listNewest(long userId, int limit) {
    return dsl.selectFrom(AI_MEMORY)
        .where(AI_MEMORY.USER_ID.eq(userId))
        .orderBy(AI_MEMORY.UPDATED_AT.desc(), AI_MEMORY.ID.desc())
        .limit(limit)
        .fetch(AiMemoryRepository::toRow);
  }

  /** 행 잠금 조회 — 고치기 전 이전 내용을 정확히 돌려주기 위해(동시 고치기 직렬화). */
  public Optional<Row> lock(long userId, long id) {
    return dsl.selectFrom(AI_MEMORY)
        .where(AI_MEMORY.ID.eq(id))
        .and(AI_MEMORY.USER_ID.eq(userId))
        .forUpdate()
        .fetchOptional(AiMemoryRepository::toRow);
  }

  /** 본인 메모리 개수 — 상한(50) 검사용. */
  public int count(long userId) {
    return dsl.fetchCount(AI_MEMORY, AI_MEMORY.USER_ID.eq(userId));
  }

  /** 이 사용자의 생성·복원을 트랜잭션 끝까지 직렬화한다(자동 해제). */
  public void lockUser(long userId) {
    // 2-int 잠금 키라 user id 를 int 로 접는다 — 21억을 넘는 id 가 다른 사용자와 겹쳐도 같은 잠금을 잠깐 나눠 쓸 뿐(직렬화가 넓어질 뿐 정합성은
    // 같다).
    dsl.execute("SELECT pg_advisory_xact_lock(?, ?)", LOCK_CLASS, (int) userId);
  }

  /** 메모리 1건 저장 후 저장된 행을 돌려준다(상한 검사는 호출자가 잠금 안에서 한다). */
  public Row insert(long userId, String kind, String content, String source, UUID sourceSessionId) {
    return toRow(
        dsl.insertInto(AI_MEMORY)
            .set(newRecord(userId, kind, content, source, sourceSessionId))
            .returning()
            .fetchOne());
  }

  /**
   * 지정한 id 로 1건 저장(되돌리기의 되살리기 — 원래 id 유지). 그 id 가 이미 있거나(ON CONFLICT DO NOTHING — 예외로 트랜잭션을 깨지 않는다)
   * 시퀀스가 아직 발급하지 않은 값이면 empty 를 돌려 호출자가 새 id 로 만들게 한다. 발급 전 값을 넣으면 나중에 시퀀스가 그 값에 닿을 때 일반 저장이 키 충돌로
   * 실패하므로 막는다.
   */
  public Optional<Row> insertWithId(
      long id, long userId, String kind, String content, String source, UUID sourceSessionId) {
    if (id <= 0 || id > lastIssued(dsl, ID_SEQUENCE)) return Optional.empty();
    AiMemoryRecord r = newRecord(userId, kind, content, source, sourceSessionId);
    r.setId(id);
    return dsl.insertInto(AI_MEMORY)
        .set(r)
        .onConflict(AI_MEMORY.ID)
        .doNothing()
        .returning()
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
   * DEFAULT(GUC)가 채운다.
   */
  private AiMemoryRecord newRecord(
      long userId, String kind, String content, String source, UUID sourceSessionId) {
    OffsetDateTime now = OffsetDateTime.now(ZoneOffset.UTC);
    AiMemoryRecord r = dsl.newRecord(AI_MEMORY);
    r.setUserId(userId);
    r.setKind(kind);
    r.setContent(content);
    r.setSource(source);
    r.setSourceSessionId(sourceSessionId);
    r.setCreatedAt(now);
    r.setUpdatedAt(now);
    return r;
  }

  /** 종류·내용을 바꾸고 맨 위로 올린다(updated_at 갱신) — 없거나 남의 것이면 empty. */
  public Optional<Row> update(long userId, long id, String kind, String content) {
    return dsl.update(AI_MEMORY)
        .set(AI_MEMORY.KIND, kind)
        .set(AI_MEMORY.CONTENT, content)
        .set(AI_MEMORY.UPDATED_AT, OffsetDateTime.now(ZoneOffset.UTC))
        .where(AI_MEMORY.ID.eq(id))
        .and(AI_MEMORY.USER_ID.eq(userId))
        .returning()
        .fetchOptional()
        .map(AiMemoryRepository::toRow);
  }

  /** 지운 행(없으면 empty) — 응답·도구 결과가 지운 kind·content·source 를 돌려준다. */
  public Optional<Row> delete(long userId, long id) {
    return dsl.deleteFrom(AI_MEMORY)
        .where(AI_MEMORY.ID.eq(id))
        .and(AI_MEMORY.USER_ID.eq(userId))
        .returning()
        .fetchOptional()
        .map(AiMemoryRepository::toRow);
  }

  /** 본인 메모리를 모두 지우고 지운 개수를 돌려준다. */
  public int deleteAll(long userId) {
    return dsl.deleteFrom(AI_MEMORY).where(AI_MEMORY.USER_ID.eq(userId)).execute();
  }

  private static Row toRow(AiMemoryRecord r) {
    return new Row(
        r.getId(),
        r.getKind(),
        r.getContent(),
        r.getSource(),
        r.getSourceSessionId(),
        r.getCreatedAt().toInstant(),
        r.getUpdatedAt().toInstant());
  }
}
