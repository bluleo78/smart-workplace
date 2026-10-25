package com.workplace.issue.repository;

import static com.workplace.jooq.Tables.ISSUE_DEPENDENCY;
import static com.workplace.jooq.Tables.ISSUE_EXTERNAL_LINK;
import static com.workplace.jooq.Tables.ISSUE_RELATION;
import static com.workplace.jooq.Tables.ISSUE_RELATION_TYPE;
import static org.jooq.impl.DSL.count;
import static org.jooq.impl.DSL.lower;

import com.workplace.issue.dto.IssueRelationTypeRow;
import java.time.OffsetDateTime;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
import org.jooq.Record;
import org.springframework.stereotype.Repository;

/**
 * 이슈 관계 유형(issue_relation_type) jOOQ 리포지토리 — 유형 CRUD와 사용 건수, 유형 삭제 때의 관계·외부 링크 옮기기/삭제. 모든 조회는 RLS 가
 * 현재 워크스페이스로 한정한다.
 */
@Repository
@RequiredArgsConstructor
public class IssueRelationTypeRepository {

  private final DSLContext dsl;

  private IssueRelationTypeRow mapToRow(Record r) {
    return new IssueRelationTypeRow(
        r.get(ISSUE_RELATION_TYPE.ID),
        r.get(ISSUE_RELATION_TYPE.CODE),
        r.get(ISSUE_RELATION_TYPE.NAME),
        r.get(ISSUE_RELATION_TYPE.DIRECTED),
        r.get(ISSUE_RELATION_TYPE.OUTWARD_LABEL),
        r.get(ISSUE_RELATION_TYPE.INWARD_LABEL),
        r.get(ISSUE_RELATION_TYPE.EXTERNAL_ONLY),
        r.get(ISSUE_RELATION_TYPE.HIDDEN),
        r.get(ISSUE_RELATION_TYPE.SORT_ORDER));
  }

  /** 전체 유형 — 정렬값, id 순(기본 유형 → 추가 유형 생성 순). */
  public List<IssueRelationTypeRow> findAll() {
    return dsl.selectFrom(ISSUE_RELATION_TYPE)
        .orderBy(ISSUE_RELATION_TYPE.SORT_ORDER, ISSUE_RELATION_TYPE.ID)
        .fetch(this::mapToRow);
  }

  public Optional<IssueRelationTypeRow> findById(long id) {
    return dsl.selectFrom(ISSUE_RELATION_TYPE)
        .where(ISSUE_RELATION_TYPE.ID.eq(id))
        .fetchOptional(this::mapToRow);
  }

  /**
   * id 로 유형을 읽으며 커밋까지 공유 잠금(FOR SHARE) — 관계를 넣는 쓰기가 쓴다. 같은 순간 유형 삭제가 끼면 삭제가 이 커밋을 기다려, 넣은 관계까지 보고
   * 옮기거나 지운다(잠그지 않으면 삭제 뒤 넣은 관계가 RESTRICT 에 걸려 500 이 났다).
   */
  public Optional<IssueRelationTypeRow> findByIdForShare(long id) {
    return dsl.selectFrom(ISSUE_RELATION_TYPE)
        .where(ISSUE_RELATION_TYPE.ID.eq(id))
        .forShare()
        .fetchOptional(this::mapToRow);
  }

  /**
   * id 로 유형을 읽으며 커밋까지 쓰기 잠금(FOR UPDATE) — 유형 삭제·편집이 쓴다. 관계 넣기({@link #findByIdForShare})와 차례를 세워,
   * 사용 건수를 센 뒤에 끼어든 관계가 없게 한다.
   */
  public Optional<IssueRelationTypeRow> findByIdForUpdate(long id) {
    return dsl.selectFrom(ISSUE_RELATION_TYPE)
        .where(ISSUE_RELATION_TYPE.ID.eq(id))
        .forUpdate()
        .fetchOptional(this::mapToRow);
  }

  /** 기본 유형 코드(정확 일치)로 조회. */
  public Optional<IssueRelationTypeRow> findByCode(String code) {
    return dsl.selectFrom(ISSUE_RELATION_TYPE)
        .where(ISSUE_RELATION_TYPE.CODE.eq(code))
        .fetchOptional(this::mapToRow);
  }

  /** 이름(대소문자 무시)으로 조회 — 기본 유형 이름도 포함. */
  public Optional<IssueRelationTypeRow> findByNameIgnoreCase(String name) {
    return dsl.selectFrom(ISSUE_RELATION_TYPE)
        .where(lower(ISSUE_RELATION_TYPE.NAME).eq(name.toLowerCase(Locale.ROOT)))
        .fetchOptional(this::mapToRow);
  }

  /** 같은 이름(대소문자 무시)이 {@code exceptId} 를 뺀 다른 유형에 있는가. 신규면 exceptId 에 0 을 준다. */
  public boolean existsNameExcept(String name, long exceptId) {
    return dsl.fetchExists(
        dsl.selectOne()
            .from(ISSUE_RELATION_TYPE)
            .where(
                lower(ISSUE_RELATION_TYPE.NAME)
                    .eq(name.toLowerCase(Locale.ROOT))
                    .and(ISSUE_RELATION_TYPE.ID.ne(exceptId))));
  }

  /** 사용자 정의 유형(코드 없음) 개수 — 상한 검사용. */
  public int countCustom() {
    return dsl.fetchCount(ISSUE_RELATION_TYPE, ISSUE_RELATION_TYPE.CODE.isNull());
  }

  /** 사용자 정의 유형 추가 — 정렬값은 호출자가 준다(1000). */
  public IssueRelationTypeRow insertCustom(
      long createdBy,
      String name,
      boolean directed,
      String outwardLabel,
      String inwardLabel,
      int sortOrder) {
    return dsl.insertInto(ISSUE_RELATION_TYPE)
        .set(ISSUE_RELATION_TYPE.NAME, name)
        .set(ISSUE_RELATION_TYPE.DIRECTED, directed)
        .set(ISSUE_RELATION_TYPE.OUTWARD_LABEL, outwardLabel)
        .set(ISSUE_RELATION_TYPE.INWARD_LABEL, inwardLabel)
        .set(ISSUE_RELATION_TYPE.SORT_ORDER, sortOrder)
        .set(ISSUE_RELATION_TYPE.CREATED_BY, createdBy)
        .returning()
        .fetchOne(this::mapToRow);
  }

  /** 이름·방향·말 갱신. */
  public void update(
      long id, String name, boolean directed, String outwardLabel, String inwardLabel) {
    dsl.update(ISSUE_RELATION_TYPE)
        .set(ISSUE_RELATION_TYPE.NAME, name)
        .set(ISSUE_RELATION_TYPE.DIRECTED, directed)
        .set(ISSUE_RELATION_TYPE.OUTWARD_LABEL, outwardLabel)
        .set(ISSUE_RELATION_TYPE.INWARD_LABEL, inwardLabel)
        .set(ISSUE_RELATION_TYPE.UPDATED_AT, OffsetDateTime.now())
        .where(ISSUE_RELATION_TYPE.ID.eq(id))
        .execute();
  }

  public void setHidden(long id, boolean hidden) {
    dsl.update(ISSUE_RELATION_TYPE)
        .set(ISSUE_RELATION_TYPE.HIDDEN, hidden)
        .set(ISSUE_RELATION_TYPE.UPDATED_AT, OffsetDateTime.now())
        .where(ISSUE_RELATION_TYPE.ID.eq(id))
        .execute();
  }

  public void delete(long id) {
    dsl.deleteFrom(ISSUE_RELATION_TYPE).where(ISSUE_RELATION_TYPE.ID.eq(id)).execute();
  }

  /** 유형별 내부 관계 건수(issue_relation). 건수 0 인 유형은 맵에 없다. */
  public Map<Long, Long> relationCountsByType() {
    return countsByType(
        dsl.select(ISSUE_RELATION.TYPE_ID, count())
            .from(ISSUE_RELATION)
            .groupBy(ISSUE_RELATION.TYPE_ID)
            .fetch());
  }

  /** 유형별 외부 링크 건수. 건수 0 인 유형은 맵에 없다. */
  public Map<Long, Long> externalLinkCountsByType() {
    return countsByType(
        dsl.select(ISSUE_EXTERNAL_LINK.TYPE_ID, count())
            .from(ISSUE_EXTERNAL_LINK)
            .groupBy(ISSUE_EXTERNAL_LINK.TYPE_ID)
            .fetch());
  }

  private static Map<Long, Long> countsByType(List<? extends Record> rows) {
    Map<Long, Long> m = new HashMap<>();
    for (Record r : rows) {
      m.put(r.get(0, Long.class), r.get(1, Long.class));
    }
    return m;
  }

  /** 차단(BLOCKS) 관계 건수 — 저장이 issue_dependency 라 그 행 수를 센다. */
  public long countDependencies() {
    return dsl.fetchCount(ISSUE_DEPENDENCY);
  }

  public long countRelations(long typeId) {
    return dsl.fetchCount(ISSUE_RELATION, ISSUE_RELATION.TYPE_ID.eq(typeId));
  }

  public long countExternalLinks(long typeId) {
    return dsl.fetchCount(ISSUE_EXTERNAL_LINK, ISSUE_EXTERNAL_LINK.TYPE_ID.eq(typeId));
  }

  /**
   * {@code fromTypeId} 의 내부 관계를 {@code toTypeId} 로 옮긴다(원래 행은 지우지 않는다 — {@link #deleteRelations}).
   * 방향 없는 대상이면 두 이슈 쌍을 (작은 id, 큰 id) 로 정규화해 A→B·B→A 가 둘 다 있던 쌍이 하나로 합쳐지고, 방향 있는 대상이면 저장된 순서를 그대로
   * 쓴다. 대상에 같은 쌍이 이미 있으면 건너뛴다(ON CONFLICT DO NOTHING).
   */
  public int copyRelations(long fromTypeId, long toTypeId, boolean toDirected) {
    String source = toDirected ? "source_issue_id" : "LEAST(source_issue_id, target_issue_id)";
    String target = toDirected ? "target_issue_id" : "GREATEST(source_issue_id, target_issue_id)";
    return dsl.execute(
        "INSERT INTO issue_relation (tenant_id, type_id, source_issue_id, target_issue_id,"
            + " created_by, created_at) SELECT tenant_id, ?, "
            + source
            + ", "
            + target
            + ", created_by, created_at FROM issue_relation WHERE type_id = ?"
            + " ON CONFLICT (type_id, source_issue_id, target_issue_id) DO NOTHING",
        toTypeId,
        fromTypeId);
  }

  /** 유형의 내부 관계를 모두 지운다 — 건수를 돌려준다. */
  public int deleteRelations(long typeId) {
    return dsl.deleteFrom(ISSUE_RELATION).where(ISSUE_RELATION.TYPE_ID.eq(typeId)).execute();
  }

  /** 외부 링크의 유형을 옮긴다. 방향 없는 대상이면 「이 이슈가 A 쪽인가」 의미가 없어지므로 true 로 맞춘다(방향 없는 유형 링크의 저장 규약). */
  public int moveExternalLinks(long fromTypeId, long toTypeId, boolean toDirected) {
    var update =
        dsl.update(ISSUE_EXTERNAL_LINK)
            .set(ISSUE_EXTERNAL_LINK.TYPE_ID, toTypeId)
            .set(ISSUE_EXTERNAL_LINK.UPDATED_AT, OffsetDateTime.now());
    if (!toDirected) {
      return update
          .set(ISSUE_EXTERNAL_LINK.ISSUE_IS_SOURCE, true)
          .where(ISSUE_EXTERNAL_LINK.TYPE_ID.eq(fromTypeId))
          .execute();
    }
    return update.where(ISSUE_EXTERNAL_LINK.TYPE_ID.eq(fromTypeId)).execute();
  }

  public int deleteExternalLinks(long typeId) {
    return dsl.deleteFrom(ISSUE_EXTERNAL_LINK)
        .where(ISSUE_EXTERNAL_LINK.TYPE_ID.eq(typeId))
        .execute();
  }
}
