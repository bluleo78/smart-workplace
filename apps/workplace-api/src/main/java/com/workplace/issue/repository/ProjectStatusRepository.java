package com.workplace.issue.repository;

import static com.workplace.jooq.Tables.PROJECT_STATUS;

import com.workplace.issue.dto.IssueStatuses;
import com.workplace.issue.dto.ProjectStatusRow;
import com.workplace.issue.exception.StatusNotFoundException;
import java.time.OffsetDateTime;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.jooq.CaseValueStep;
import org.jooq.CaseWhenStep;
import org.jooq.DSLContext;
import org.jooq.Field;
import org.jooq.Record;
import org.jooq.SortField;
import org.jooq.impl.DSL;
import org.springframework.stereotype.Repository;

/**
 * 프로젝트별 이슈 상태(project_status) jOOQ 리포지토리(WP-807). 목록은 늘 「범주 순서 → position → id」 로 정렬해 보드 컬럼 순서와 같게
 * 돌려준다. 이름 유일성은 DB 유일 인덱스(project_id, lower(btrim(name)))가 최종 보장하고, 위반은 Spring 예외 변환으로 {@code
 * DuplicateKeyException} 이 된다.
 */
@Repository
@RequiredArgsConstructor
public class ProjectStatusRepository {

  private final DSLContext dsl;

  /** 범주를 {@link IssueStatuses#CATEGORY_ORDER} 의 순번(0~3)으로 바꾸는 CASE 식 — 범주 순 정렬에 쓴다. */
  private static final Field<Integer> CATEGORY_RANK = categoryRank();

  private static Field<Integer> categoryRank() {
    CaseValueStep<String> c = DSL.choose(PROJECT_STATUS.CATEGORY);
    List<String> order = IssueStatuses.CATEGORY_ORDER;
    CaseWhenStep<String, Integer> step = c.when(order.get(0), DSL.inline(0));
    for (int i = 1; i < order.size(); i++) {
      step = step.when(order.get(i), DSL.inline(i));
    }
    return step.otherwise(DSL.inline(order.size()));
  }

  /** 보드·목록 표시 순서 — 범주 순서, 그 안에서 position, 같으면 id. */
  private static final SortField<?>[] DISPLAY_ORDER = {
    CATEGORY_RANK.asc(), PROJECT_STATUS.POSITION.asc(), PROJECT_STATUS.ID.asc()
  };

  /** SELECT 결과를 {@link ProjectStatusRow} 로 매핑. */
  private ProjectStatusRow mapToRow(Record r) {
    OffsetDateTime c = r.get(PROJECT_STATUS.CREATED_AT);
    OffsetDateTime u = r.get(PROJECT_STATUS.UPDATED_AT);
    return new ProjectStatusRow(
        r.get(PROJECT_STATUS.ID),
        r.get(PROJECT_STATUS.PROJECT_ID),
        r.get(PROJECT_STATUS.NAME),
        r.get(PROJECT_STATUS.CATEGORY),
        r.get(PROJECT_STATUS.POSITION),
        c != null ? c.toInstant() : null,
        u != null ? u.toInstant() : null);
  }

  /** 프로젝트의 상태 전부 — 범주 순서 → position 순. */
  public List<ProjectStatusRow> findByProject(Long projectId) {
    return dsl.selectFrom(PROJECT_STATUS)
        .where(PROJECT_STATUS.PROJECT_ID.eq(projectId))
        .orderBy(DISPLAY_ORDER)
        .fetch(this::mapToRow);
  }

  /** id 로 단건 조회. */
  public Optional<ProjectStatusRow> findById(Long id) {
    return dsl.selectFrom(PROJECT_STATUS)
        .where(PROJECT_STATUS.ID.eq(id))
        .fetchOptional(this::mapToRow);
  }

  /** 범주의 기본 상태 — 그 범주에서 가장 앞(position 최소) 상태. SQL 함수 project_status_default_id 와 같은 규칙. */
  public Optional<ProjectStatusRow> findDefault(Long projectId, String category) {
    return dsl.selectFrom(PROJECT_STATUS)
        .where(PROJECT_STATUS.PROJECT_ID.eq(projectId).and(PROJECT_STATUS.CATEGORY.eq(category)))
        .orderBy(PROJECT_STATUS.POSITION.asc(), PROJECT_STATUS.ID.asc())
        .limit(1)
        .fetchOptional(this::mapToRow);
  }

  /** id 묶음 조회(N+1 회피). 빈 입력은 빈 목록. */
  public List<ProjectStatusRow> findByIds(Collection<Long> ids) {
    if (ids == null || ids.isEmpty()) return List.of();
    return dsl.selectFrom(PROJECT_STATUS)
        .where(PROJECT_STATUS.ID.in(ids))
        .orderBy(DISPLAY_ORDER)
        .fetch(this::mapToRow);
  }

  /**
   * 프로젝트의 상태 행을 모두 잠근다(FOR UPDATE) — 상태 추가가 position 을 정하고 뒤 행을 밀어내는 동안 같은 프로젝트의 다른 추가가 끼어들지 못하게.
   * 잠금을 기다렸던 쪽은 상대가 커밋한 새 행을 이 결과에서 보지 못하므로(READ COMMITTED), position 계산은 잠근 뒤 다시 조회해서 한다.
   */
  public List<ProjectStatusRow> lockByProject(Long projectId) {
    return dsl.selectFrom(PROJECT_STATUS)
        .where(PROJECT_STATUS.PROJECT_ID.eq(projectId))
        .orderBy(PROJECT_STATUS.ID.asc())
        .forUpdate()
        .fetch(this::mapToRow);
  }

  /** position 이 주어진 값보다 큰 상태를 한 칸씩 뒤로 민다 — 그 바로 뒤 자리(position + 1)를 비우기 위해. */
  public void shiftPositionsAfter(Long projectId, int position) {
    dsl.update(PROJECT_STATUS)
        .set(PROJECT_STATUS.POSITION, PROJECT_STATUS.POSITION.plus(1))
        .where(PROJECT_STATUS.PROJECT_ID.eq(projectId).and(PROJECT_STATUS.POSITION.gt(position)))
        .execute();
  }

  /** 상태 추가. 이름 유일 위반은 {@code DuplicateKeyException}(서비스가 409 로). */
  public ProjectStatusRow insert(Long projectId, String name, String category, int position) {
    return dsl.insertInto(PROJECT_STATUS)
        .set(PROJECT_STATUS.PROJECT_ID, projectId)
        .set(PROJECT_STATUS.NAME, name)
        .set(PROJECT_STATUS.CATEGORY, category)
        .set(PROJECT_STATUS.POSITION, position)
        .returning()
        .fetchOptional()
        .map(this::mapToRow)
        .orElseThrow(() -> new IllegalStateException("INSERT RETURNING 결과 없음"));
  }

  /**
   * 이름만 바꾼다(범주·position 유지). 이름 유일 위반은 {@code DuplicateKeyException}. 그 사이 지워져 행이 없으면 처음 찾을 때와 같은
   * 404(500 대신, WP-755 와 같은 이유).
   */
  public ProjectStatusRow rename(Long id, String name) {
    return dsl.update(PROJECT_STATUS)
        .set(PROJECT_STATUS.NAME, name)
        .set(PROJECT_STATUS.UPDATED_AT, OffsetDateTime.now())
        .where(PROJECT_STATUS.ID.eq(id))
        .returning()
        .fetchOptional()
        .map(this::mapToRow)
        .orElseThrow(StatusNotFoundException::new);
  }

  /**
   * 같은 프로젝트에 대소문자·앞뒤 공백만 다른 같은 이름이 있는가 — 유일 인덱스와 같은 식(lower(btrim))으로 비교한다.
   *
   * @param excludeId 이름을 바꾸는 상태 자신(추가할 때는 null)
   */
  public boolean existsName(Long projectId, String name, Long excludeId) {
    var cond =
        PROJECT_STATUS
            .PROJECT_ID
            .eq(projectId)
            .and(DSL.lower(DSL.trim(PROJECT_STATUS.NAME)).eq(DSL.lower(DSL.trim(DSL.val(name)))));
    if (excludeId != null) cond = cond.and(PROJECT_STATUS.ID.ne(excludeId));
    return dsl.fetchExists(PROJECT_STATUS, cond);
  }

  /** 여러 프로젝트에서 이름으로 상태를 찾는다(대소문자·앞뒤 공백 무시) — 프로젝트 횡단 이슈 검색의 상태 이름 필터를 id 로 해석할 때 쓴다. 빈 입력은 빈 목록. */
  public List<ProjectStatusRow> findByNamesInProjects(
      Collection<Long> projectIds, Collection<String> names) {
    if (projectIds == null || projectIds.isEmpty() || names == null || names.isEmpty()) {
      return List.of();
    }
    // 비교 키도 DB 의 lower(btrim) 로 만든다 — 자바 쪽 소문자·공백 규칙과 어긋나지 않게(유일 인덱스와 같은 식)
    List<Field<String>> keys = names.stream().map(n -> DSL.lower(DSL.trim(DSL.val(n)))).toList();
    return dsl.selectFrom(PROJECT_STATUS)
        .where(
            PROJECT_STATUS
                .PROJECT_ID
                .in(projectIds)
                .and(DSL.lower(DSL.trim(PROJECT_STATUS.NAME)).in(keys)))
        .orderBy(DISPLAY_ORDER)
        .fetch(this::mapToRow);
  }
}
