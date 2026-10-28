package com.workplace.component.repository;

import static com.workplace.jooq.Tables.ISSUE;
import static com.workplace.jooq.Tables.ISSUE_COMPONENT;
import static com.workplace.jooq.Tables.PROJECT;
import static com.workplace.jooq.Tables.PROJECT_COMPONENT;

import com.workplace.component.dto.ComponentRow;
import com.workplace.component.dto.ComponentSummary;
import com.workplace.global.share.ProjectMembership;
import com.workplace.jooq.tables.records.ProjectComponentRecord;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
import org.jooq.Field;
import org.jooq.OrderField;
import org.jooq.Record;
import org.jooq.ResultQuery;
import org.jooq.exception.IntegrityConstraintViolationException;
import org.jooq.impl.DSL;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.stereotype.Repository;

/**
 * project_component·issue_component 의 jOOQ 저장소(WP-933). 목록 순서는 언제나 {@code lower(name)} 오름차순, 같으면 id
 * — 설정·피커·필터·칩과 「먼저 나오는 구성요소」(자동 지정 기준)가 같은 순서를 쓴다. 이름 유일(프로젝트 안, 대소문자 무시)은 DB 유일 인덱스가 지키고 위반은
 * DuplicateKeyException 으로 바꿔 올린다.
 */
@Repository
@RequiredArgsConstructor
public class ComponentRepository {

  /** 목록 순서 — 이름(대소문자 무시) 오름차순, 같으면 id. */
  private static final List<OrderField<?>> LIST_ORDER =
      List.of(DSL.lower(PROJECT_COMPONENT.NAME).asc(), PROJECT_COMPONENT.ID.asc());

  private final DSLContext dsl;

  /** SELECT 결과 → ComponentRow. */
  private ComponentRow mapToRow(Record r) {
    OffsetDateTime archived = r.get(PROJECT_COMPONENT.ARCHIVED_AT);
    OffsetDateTime created = r.get(PROJECT_COMPONENT.CREATED_AT);
    OffsetDateTime updated = r.get(PROJECT_COMPONENT.UPDATED_AT);
    return new ComponentRow(
        r.get(PROJECT_COMPONENT.ID),
        r.get(PROJECT_COMPONENT.PROJECT_ID),
        r.get(PROJECT_COMPONENT.NAME),
        r.get(PROJECT_COMPONENT.DESCRIPTION),
        r.get(PROJECT_COMPONENT.DEFAULT_ASSIGNEE_ID),
        archived != null ? archived.toInstant() : null,
        r.get(PROJECT_COMPONENT.CREATED_BY),
        created != null ? created.toInstant() : null,
        updated != null ? updated.toInstant() : null);
  }

  /** 프로젝트의 구성요소 전체(보관 포함), 목록 순서. */
  public List<ComponentRow> listByProject(long projectId) {
    return dsl.selectFrom(PROJECT_COMPONENT)
        .where(PROJECT_COMPONENT.PROJECT_ID.eq(projectId))
        .orderBy(LIST_ORDER)
        .fetch(this::mapToRow);
  }

  /**
   * 호출자가 멤버인 모든 프로젝트의 구성요소(보관 포함), 목록 순서 — 프로젝트 횡단 검색(/me/issues)의 이름 필터 해석용. 라벨의 같은 이름 메서드와 같은
   * 범위다.
   */
  public List<ComponentRow> findByMemberProjects(long userId) {
    return dsl.selectFrom(PROJECT_COMPONENT)
        .where(
            PROJECT_COMPONENT.PROJECT_ID.in(
                // 직접 멤버 + 멤버로 둔 조직도 부서로 들어온 프로젝트(WP-1057)
                ProjectMembership.projectIdsOf(DSL.val(userId))))
        .orderBy(LIST_ORDER)
        .fetch(this::mapToRow);
  }

  /** id 로 단건 조회(프로젝트 소속은 호출부가 확인). */
  public Optional<ComponentRow> findById(long id) {
    return dsl.selectFrom(PROJECT_COMPONENT)
        .where(PROJECT_COMPONENT.ID.eq(id))
        .fetchOptional(this::mapToRow);
  }

  /**
   * 단건 조회 + 행 잠금({@code FOR UPDATE}). 이름 변경·삭제가 같은 구성요소의 동시 변경과 겹치지 않게 한다 — 삭제는 이 잠금 아래에서 붙은 이슈를 읽어
   * 이력을 남기므로, 그 사이 새로 붙이려는 요청은 잠금이 풀린 뒤 외래키 위반으로 실패한다.
   */
  public Optional<ComponentRow> lockById(long id) {
    return dsl.selectFrom(PROJECT_COMPONENT)
        .where(PROJECT_COMPONENT.ID.eq(id))
        .forUpdate()
        .fetchOptional(this::mapToRow);
  }

  /**
   * 프로젝트 행을 잠가(FOR NO KEY UPDATE) 구성요소 추가를 직렬화한다 — 개수 상한 검사와 삽입 사이에 다른 추가가 끼어 상한을 넘기지 않게 한다. 이슈 생성이
   * 잡는 FOR KEY SHARE 와는 충돌하지 않는다.
   */
  public void lockProject(long projectId) {
    dsl.select(PROJECT.ID).from(PROJECT).where(PROJECT.ID.eq(projectId)).forNoKeyUpdate().fetch();
  }

  /** 프로젝트의 구성요소 수(보관 포함) — 상한 검사용. */
  public int countByProject(long projectId) {
    return dsl.fetchCount(PROJECT_COMPONENT, PROJECT_COMPONENT.PROJECT_ID.eq(projectId));
  }

  /**
   * 프로젝트 안의 id 들에 해당하는 구성요소(보관 포함), 목록 순서. 다른 프로젝트·없는 id 는 빠진다.
   *
   * @param forShare true 면 행을 공유 잠금한다({@code FOR SHARE}) — 이슈에 붙이는 쓰기가 「보관됨 확인 → INSERT」 사이에 동시
   *     보관·삭제가 끼어들지 못하게 한다. 보관·이름 변경·삭제({@link #lockById})는 {@code FOR UPDATE} 라 이쪽이 먼저면 그 커밋을, 저쪽이
   *     먼저면 그 결과(보관됨·없음)를 읽는다. 읽기 전용 트랜잭션에서는 쓰지 않는다(PG 가 FOR SHARE 를 거절).
   */
  public List<ComponentRow> findByIds(long projectId, Collection<Long> ids, boolean forShare) {
    if (ids == null || ids.isEmpty()) return List.of();
    var query =
        dsl.selectFrom(PROJECT_COMPONENT)
            .where(PROJECT_COMPONENT.PROJECT_ID.eq(projectId).and(PROJECT_COMPONENT.ID.in(ids)))
            .orderBy(LIST_ORDER);
    ResultQuery<ProjectComponentRecord> q = forShare ? query.forShare() : query;
    return q.fetch(this::mapToRow);
  }

  /**
   * 프로젝트 안에서 이름이 같은(대소문자 무시 — 유일 인덱스 lower(name) 과 같은 기준) 구성요소, 목록 순서. 보관된 것도 포함한다 — 보관 여부로 거를지는
   * 호출부가 정한다(이슈에 붙이기는 거절, 가져오기는 허용).
   */
  public List<ComponentRow> findByNamesIgnoreCase(long projectId, Collection<String> names) {
    if (names == null || names.isEmpty()) return List.of();
    return dsl.selectFrom(PROJECT_COMPONENT)
        .where(
            PROJECT_COMPONENT
                .PROJECT_ID
                .eq(projectId)
                .and(
                    DSL.lower(PROJECT_COMPONENT.NAME)
                        .in(names.stream().map(n -> n.toLowerCase(Locale.ROOT)).toList())))
        .orderBy(LIST_ORDER)
        .fetch(this::mapToRow);
  }

  /** 신규 구성요소 삽입. 이름 중복은 DuplicateKeyException. */
  public ComponentRow insert(
      long projectId, String name, String description, Long defaultAssigneeId, Long createdBy) {
    try {
      return dsl.insertInto(PROJECT_COMPONENT)
          .set(PROJECT_COMPONENT.PROJECT_ID, projectId)
          .set(PROJECT_COMPONENT.NAME, name)
          .set(PROJECT_COMPONENT.DESCRIPTION, description)
          .set(PROJECT_COMPONENT.DEFAULT_ASSIGNEE_ID, defaultAssigneeId)
          .set(PROJECT_COMPONENT.CREATED_BY, createdBy)
          .returning()
          .fetchOptional()
          .map(this::mapToRow)
          .orElseThrow(() -> new IllegalStateException("INSERT RETURNING 결과 없음"));
    } catch (IntegrityConstraintViolationException e) {
      throw new DuplicateKeyException("component name duplicated", e);
    }
  }

  /** 이름·설명·담당자·보관 여부를 한 번에 갱신(호출부가 최종 값을 계산해 넘긴다). 이름 중복은 DuplicateKeyException. */
  public void update(
      long id, String name, String description, Long defaultAssigneeId, boolean archived) {
    try {
      dsl.update(PROJECT_COMPONENT)
          .set(PROJECT_COMPONENT.NAME, name)
          .set(PROJECT_COMPONENT.DESCRIPTION, description)
          .set(PROJECT_COMPONENT.DEFAULT_ASSIGNEE_ID, defaultAssigneeId)
          // 이미 보관된 것을 다시 보관해도 보관 시각이 밀리지 않게 기존 값을 유지한다.
          .set(
              PROJECT_COMPONENT.ARCHIVED_AT,
              archived
                  ? DSL.coalesce(PROJECT_COMPONENT.ARCHIVED_AT, DSL.currentOffsetDateTime())
                  : DSL.val((OffsetDateTime) null))
          .set(PROJECT_COMPONENT.UPDATED_AT, OffsetDateTime.now())
          .where(PROJECT_COMPONENT.ID.eq(id))
          .execute();
    } catch (IntegrityConstraintViolationException e) {
      throw new DuplicateKeyException("component name duplicated", e);
    }
  }

  /** 구성요소 삭제 — issue_component 는 외래키 cascade 로 함께 사라진다. */
  public void delete(long id) {
    dsl.deleteFrom(PROJECT_COMPONENT).where(PROJECT_COMPONENT.ID.eq(id)).execute();
  }

  /** 이 구성요소가 붙은 이슈 id(삭제된 이슈 포함) — 삭제(cascade) 전에 읽어 이슈마다 제거 이력을 남긴다. */
  public List<Long> findIssueIdsByComponent(long componentId) {
    return dsl.select(ISSUE_COMPONENT.ISSUE_ID)
        .from(ISSUE_COMPONENT)
        .where(ISSUE_COMPONENT.COMPONENT_ID.eq(componentId))
        .fetch(ISSUE_COMPONENT.ISSUE_ID);
  }

  /** 구성요소별 (삭제되지 않은) 이슈 수 — 목록·삭제 확인창용. 붙은 이슈가 없는 구성요소는 맵에 없다. */
  public Map<Long, Integer> countLiveIssuesByComponents(Collection<Long> componentIds) {
    if (componentIds == null || componentIds.isEmpty()) return Map.of();
    Field<Integer> cnt = DSL.count();
    var out = new HashMap<Long, Integer>();
    dsl.select(ISSUE_COMPONENT.COMPONENT_ID, cnt)
        .from(ISSUE_COMPONENT)
        .join(ISSUE)
        .on(ISSUE.ID.eq(ISSUE_COMPONENT.ISSUE_ID))
        .where(ISSUE_COMPONENT.COMPONENT_ID.in(componentIds).and(ISSUE.DELETED_AT.isNull()))
        .groupBy(ISSUE_COMPONENT.COMPONENT_ID)
        .forEach(r -> out.put(r.value1(), r.value2()));
    return out;
  }

  /** 한 구성요소가 붙은 (삭제되지 않은) 이슈 수. */
  public int countLiveIssues(long componentId) {
    return countLiveIssuesByComponents(List.of(componentId)).getOrDefault(componentId, 0);
  }

  /** 한 이슈에 붙은 구성요소 요약(목록 순서) — 없으면 빈 목록. */
  public List<ComponentSummary> summariesByIssue(long issueId) {
    return summariesByIssueIds(List.of(issueId)).getOrDefault(issueId, List.of());
  }

  /** 이슈 id 들 → 이슈별 구성요소 요약, 각 목록은 구성요소 목록 순서(검색·상세 응답의 N+1 방지). 구성요소가 없는 이슈는 맵에 없다. */
  public Map<Long, List<ComponentSummary>> summariesByIssueIds(Collection<Long> issueIds) {
    if (issueIds == null || issueIds.isEmpty()) return Map.of();
    var out = new LinkedHashMap<Long, List<ComponentSummary>>();
    dsl.select(
            ISSUE_COMPONENT.ISSUE_ID,
            PROJECT_COMPONENT.ID,
            PROJECT_COMPONENT.NAME,
            PROJECT_COMPONENT.ARCHIVED_AT)
        .from(ISSUE_COMPONENT)
        .join(PROJECT_COMPONENT)
        .on(PROJECT_COMPONENT.ID.eq(ISSUE_COMPONENT.COMPONENT_ID))
        .where(ISSUE_COMPONENT.ISSUE_ID.in(issueIds))
        .orderBy(LIST_ORDER)
        .forEach(
            r ->
                out.computeIfAbsent(r.get(ISSUE_COMPONENT.ISSUE_ID), k -> new ArrayList<>())
                    .add(
                        new ComponentSummary(
                            r.get(PROJECT_COMPONENT.ID),
                            r.get(PROJECT_COMPONENT.NAME),
                            r.get(PROJECT_COMPONENT.ARCHIVED_AT) != null)));
    return out;
  }
}
