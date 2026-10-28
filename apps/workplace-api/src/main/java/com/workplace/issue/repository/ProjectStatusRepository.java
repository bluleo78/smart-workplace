package com.workplace.issue.repository;

import static com.workplace.jooq.Tables.PROJECT_STATUS;

import com.workplace.global.share.ProjectMembership;
import com.workplace.issue.dto.IssueStatuses;
import com.workplace.issue.dto.ProjectStatusRow;
import com.workplace.issue.exception.StatusNotFoundException;
import java.time.OffsetDateTime;
import java.util.Collection;
import java.util.List;
import java.util.Map;
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
 * 돌려준다. 이름 중복은 서비스가 {@link #existsName} 으로 먼저 거르고, DB 유일 인덱스(project_id, lower(btrim(name)))가 경쟁까지
 * 최종 보장한다 — 위반은 Spring 예외 변환으로 {@code DuplicateKeyException} 이 된다.
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
        r.get(PROJECT_STATUS.COLOR),
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

  /** 범주의 기본 상태 — 그 범주에서 가장 앞(position 최소, 동률이면 id) 상태. 범주만 오는 요청이 status_id 를 정할 때 쓴다. */
  public Optional<ProjectStatusRow> findDefault(Long projectId, String category) {
    return dsl.selectFrom(PROJECT_STATUS)
        .where(PROJECT_STATUS.PROJECT_ID.eq(projectId).and(PROJECT_STATUS.CATEGORY.eq(category)))
        .orderBy(PROJECT_STATUS.POSITION.asc(), PROJECT_STATUS.ID.asc())
        .limit(1)
        .fetchOptional(this::mapToRow);
  }

  /**
   * 사용자가 멤버인 프로젝트의 상태 전부 — 프로젝트 횡단 이슈 검색의 상태 이름 필터 해석 후보(유형·라벨의 findByMemberProjects 와 같은 서브쿼리 패턴).
   */
  public List<ProjectStatusRow> findByMemberProjects(Long userId) {
    return dsl.selectFrom(PROJECT_STATUS)
        .where(
            PROJECT_STATUS.PROJECT_ID.in(
                // 직접 멤버 + 멤버로 둔 조직도 부서로 들어온 프로젝트(WP-1057)
                ProjectMembership.projectIdsOf(DSL.val(userId))))
        .orderBy(DISPLAY_ORDER)
        .fetch(this::mapToRow);
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
   * 프로젝트의 상태 행을 모두 잠근다(FOR NO KEY UPDATE) — 상태 추가가 position 을 정하고 뒤 행을 밀어내는 동안, 그리고 추가·이름 변경이 이름
   * 중복을 확인하고 쓰는 동안 같은 프로젝트의 다른 추가·이름 변경이 끼어들지 못하게. NO KEY UPDATE 끼리는 서로 막아 동시 추가는 직렬화되지만, 이슈
   * INSERT·status_id 변경의 FK 검사(FOR KEY SHARE)는 막지 않는다. 잠금을 기다렸던 쪽은 상대가 커밋한 새 행을 이 결과에서 보지 못하므로(READ
   * COMMITTED), position 계산은 잠근 뒤 다시 조회해서 한다 — 그래서 잠금은 id 만 읽는다.
   */
  public void lockByProject(Long projectId) {
    dsl.select(PROJECT_STATUS.ID)
        .from(PROJECT_STATUS)
        .where(PROJECT_STATUS.PROJECT_ID.eq(projectId))
        .orderBy(PROJECT_STATUS.ID.asc())
        .forNoKeyUpdate()
        .execute();
  }

  /**
   * 지울 상태 행 하나를 FOR UPDATE 로 잠근다(WP-809). {@link #lockByProject} 의 NO KEY UPDATE 는 이슈 쪽 FK 검사(KEY
   * SHARE)를 막지 않아, 이슈를 옮긴 뒤 행을 지우기 전에 다른 요청이 이 상태로 이슈를 넣거나 옮기면 삭제가 FK 위반(500)이 된다. FOR UPDATE 는 KEY
   * SHARE 와 충돌하므로 그런 쓰기는 삭제가 끝날 때까지 기다린다 — 옮긴 뒤 끼어든 이슈 때문에 삭제 쪽이 실패하지 않는다.
   */
  public void lockForDelete(Long id) {
    dsl.select(PROJECT_STATUS.ID)
        .from(PROJECT_STATUS)
        .where(PROJECT_STATUS.ID.eq(id))
        .forUpdate()
        .execute();
  }

  /** 상태 행 삭제 — 이 상태를 가리키는 이슈를 모두 옮긴 뒤에 부른다(이슈 FK 는 ON DELETE RESTRICT). */
  public void delete(Long id) {
    dsl.deleteFrom(PROJECT_STATUS).where(PROJECT_STATUS.ID.eq(id)).execute();
  }

  /** position 이 주어진 값보다 큰 상태를 한 칸씩 뒤로 민다 — 그 바로 뒤 자리(position + 1)를 비우기 위해. */
  public void shiftPositionsAfter(Long projectId, int position) {
    dsl.update(PROJECT_STATUS)
        .set(PROJECT_STATUS.POSITION, PROJECT_STATUS.POSITION.plus(1))
        .where(PROJECT_STATUS.PROJECT_ID.eq(projectId).and(PROJECT_STATUS.POSITION.gt(position)))
        .execute();
  }

  /**
   * 여러 상태의 position 을 한 문장(CASE id WHEN … THEN …)으로 바꾼다 — 같은 범주 안 순서 변경(WP-809)이 그 범주가 쓰던 position
   * 들을 서로 맞바꾸는 데 쓴다. 행마다 따로 UPDATE 하면 중간에 순서가 어긋난 상태가 보일 수 있어 한 번에 바꾼다. 빈 입력은 아무것도 하지 않는다.
   */
  public void updatePositions(Map<Long, Integer> positionById) {
    if (positionById.isEmpty()) return;
    CaseValueStep<Long> c = DSL.choose(PROJECT_STATUS.ID);
    CaseWhenStep<Long, Integer> step = null;
    for (var e : positionById.entrySet()) {
      step =
          step == null
              ? c.when(e.getKey(), DSL.val(e.getValue()))
              : step.when(e.getKey(), DSL.val(e.getValue()));
    }
    dsl.update(PROJECT_STATUS)
        .set(PROJECT_STATUS.POSITION, step.otherwise(PROJECT_STATUS.POSITION))
        .set(PROJECT_STATUS.UPDATED_AT, OffsetDateTime.now())
        .where(PROJECT_STATUS.ID.in(positionById.keySet()))
        .execute();
  }

  /** 상태 추가. 이름 유일 위반은 {@code DuplicateKeyException}(서비스가 409 로). */
  public ProjectStatusRow insert(
      Long projectId, String name, String category, int position, String color) {
    return dsl.insertInto(PROJECT_STATUS)
        .set(PROJECT_STATUS.PROJECT_ID, projectId)
        .set(PROJECT_STATUS.NAME, name)
        .set(PROJECT_STATUS.CATEGORY, category)
        .set(PROJECT_STATUS.POSITION, position)
        .set(PROJECT_STATUS.COLOR, color)
        .returning()
        .fetchOptional()
        .map(this::mapToRow)
        .orElseThrow(() -> new IllegalStateException("INSERT RETURNING 결과 없음"));
  }

  /**
   * 이름·색 중 null 이 아닌 것만 바꾼다(범주·position 유지, WP-809). 이름 유일 위반은 {@code DuplicateKeyException}. 그 사이
   * 지워져 행이 없으면 처음 찾을 때와 같은 404(500 대신, WP-755 와 같은 이유).
   */
  public ProjectStatusRow update(Long id, String name, String color) {
    var step = dsl.update(PROJECT_STATUS).set(PROJECT_STATUS.UPDATED_AT, OffsetDateTime.now());
    if (name != null) step = step.set(PROJECT_STATUS.NAME, name);
    if (color != null) step = step.set(PROJECT_STATUS.COLOR, color);
    return step.where(PROJECT_STATUS.ID.eq(id))
        .returning()
        .fetchOptional()
        .map(this::mapToRow)
        .orElseThrow(StatusNotFoundException::new);
  }

  /**
   * 같은 프로젝트에 대소문자·앞뒤 공백만 다른 같은 이름이 있는가 — 유일 인덱스와 같은 식(lower(btrim))으로 비교한다. 서비스가 쓰기 전에 확인해 중복을 409
   * 로 돌려준다(유일 인덱스 위반은 트랜잭션을 중단시켜 같은 트랜잭션의 이후 문장이 실패한다).
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
}
