package com.workplace.cycle.repository;

import static com.workplace.jooq.Tables.CYCLE;

import com.workplace.cycle.dto.CycleRow;
import com.workplace.global.exception.UniqueViolations;
import com.workplace.global.share.ProjectMembership;
import java.time.OffsetDateTime;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
import org.jooq.Record;
import org.jooq.exception.IntegrityConstraintViolationException;
import org.jooq.impl.DSL;
import org.springframework.stereotype.Repository;

/**
 * cycle 테이블 jOOQ 리포지토리. 이름 유니크(project_id, lower(name) — 대소문자 무시, WP-1393) 위반은
 * DuplicateKeyException 으로 변환.
 */
@Repository
@RequiredArgsConstructor
public class CycleRepository {

  private final DSLContext dsl;

  /** SELECT 결과 → CycleRow 매핑. */
  private CycleRow mapToRow(Record r) {
    OffsetDateTime created = r.get(CYCLE.CREATED_AT);
    OffsetDateTime updated = r.get(CYCLE.UPDATED_AT);
    return new CycleRow(
        r.get(CYCLE.ID),
        r.get(CYCLE.PROJECT_ID),
        r.get(CYCLE.NAME),
        r.get(CYCLE.GOAL),
        r.get(CYCLE.START_DATE),
        r.get(CYCLE.END_DATE),
        r.get(CYCLE.STATUS),
        created != null ? created.toInstant() : null,
        updated != null ? updated.toInstant() : null);
  }

  /** id 로 단건 조회. */
  public Optional<CycleRow> findById(Long id) {
    return dsl.selectFrom(CYCLE).where(CYCLE.ID.eq(id)).fetchOptional(this::mapToRow);
  }

  /**
   * id 로 단건 조회하며 행을 잠근다(SELECT … FOR UPDATE). 사이클 완료(WP-1578)가 상태 확인과 쓰기 사이에 다른 완료 요청이 끼지 못하게 쓴다 —
   * 트랜잭션 안에서만 의미가 있고, 잠금은 커밋·롤백 때 풀린다.
   */
  public Optional<CycleRow> findByIdForUpdate(Long id) {
    return dsl.selectFrom(CYCLE).where(CYCLE.ID.eq(id)).forUpdate().fetchOptional(this::mapToRow);
  }

  /** 프로젝트 내 전체 사이클 (start_date desc nulls last, name asc). */
  public List<CycleRow> findByProject(Long projectId) {
    return dsl.selectFrom(CYCLE)
        .where(CYCLE.PROJECT_ID.eq(projectId))
        .orderBy(CYCLE.START_DATE.desc().nullsLast(), CYCLE.NAME.asc())
        .fetch(this::mapToRow);
  }

  /** 사용자가 멤버인 프로젝트들의 사이클 — 횡단 이슈 검색의 사이클 이름 해석 후보(WP-735). */
  public List<CycleRow> findByMemberProjects(Long userId) {
    return dsl.selectFrom(CYCLE)
        .where(
            CYCLE.PROJECT_ID.in(
                // 직접 멤버 + 멤버로 둔 조직도 부서로 들어온 프로젝트(WP-1057)
                ProjectMembership.projectIdsOf(DSL.val(userId))))
        .orderBy(CYCLE.START_DATE.desc().nullsLast(), CYCLE.NAME.asc())
        .fetch(this::mapToRow);
  }

  /** id 집합으로 일괄 조회. */
  public List<CycleRow> findByIds(List<Long> ids) {
    if (ids == null || ids.isEmpty()) return List.of();
    return dsl.selectFrom(CYCLE).where(CYCLE.ID.in(ids)).fetch(this::mapToRow);
  }

  /**
   * 사이클 행을 id 오름차순으로 공유 잠금(FOR SHARE)하며 읽는다(WP-1945) — 이슈에 사이클을 붙이는 경로가 붙이기 전에 잠가, 사이클 완료(작은 id → 큰
   * id 순 FOR UPDATE)와 같은 순서로 줄을 서게 한다(교착 방지). 완료가 먼저 쥐었으면 그 커밋을 기다렸다가 커밋 뒤의 상태(COMPLETED 등)를 읽으므로
   * 완료된 사이클에 붙지 않는다. 공유 잠금끼리는 충돌하지 않아 붙이기끼리는 서로 막지 않는다.
   *
   * <p>이 프로젝트의 사이클만 잠근다 — 다른 프로젝트 id 를 넣은 요청이 그 프로젝트 사이클(완료·수정·삭제)을 붙들지 않게 한다. 돌려받은 행 수가 요청 id 수보다
   * 적으면 없거나 다른 프로젝트 것이 섞인 것이다(호출자가 소속 오류로 거절).
   */
  public List<CycleRow> findInProjectForShare(long projectId, Collection<Long> ids) {
    if (ids == null || ids.isEmpty()) return List.of();
    return dsl.selectFrom(CYCLE)
        .where(CYCLE.ID.in(ids))
        .and(CYCLE.PROJECT_ID.eq(projectId))
        .orderBy(CYCLE.ID)
        .forShare()
        .fetch(this::mapToRow);
  }

  /** 신규 사이클 삽입. 이름 유니크(대소문자 무시) 위반은 DuplicateKeyException 으로 전파. */
  public CycleRow insert(
      Long projectId,
      String name,
      String goal,
      java.time.LocalDate startDate,
      java.time.LocalDate endDate,
      String status) {
    try {
      return dsl.insertInto(CYCLE)
          .set(CYCLE.PROJECT_ID, projectId)
          .set(CYCLE.NAME, name)
          .set(CYCLE.GOAL, goal)
          .set(CYCLE.START_DATE, startDate)
          .set(CYCLE.END_DATE, endDate)
          .set(CYCLE.STATUS, status)
          .returning()
          .fetchOptional()
          .map(this::mapToRow)
          .orElseThrow(() -> new IllegalStateException("INSERT RETURNING 결과 없음"));
    } catch (IntegrityConstraintViolationException e) {
      throw UniqueViolations.asDuplicateOr(e, NAME_UNIQUE_INDEX, "cycle name duplicated");
    }
  }

  /** 사이클 갱신. */
  public void update(
      Long id,
      String name,
      String goal,
      java.time.LocalDate startDate,
      java.time.LocalDate endDate,
      String status) {
    try {
      dsl.update(CYCLE)
          .set(CYCLE.NAME, name)
          .set(CYCLE.GOAL, goal)
          .set(CYCLE.START_DATE, startDate)
          .set(CYCLE.END_DATE, endDate)
          .set(CYCLE.STATUS, status)
          .set(CYCLE.UPDATED_AT, OffsetDateTime.now())
          .where(CYCLE.ID.eq(id))
          .execute();
    } catch (IntegrityConstraintViolationException e) {
      throw UniqueViolations.asDuplicateOr(e, NAME_UNIQUE_INDEX, "cycle name duplicated");
    }
  }

  /** 사이클 이름 유일 인덱스(V270, 대소문자 무시) — 이 위반만 이름 중복(409)으로 옮긴다(WP-1393). */
  private static final String NAME_UNIQUE_INDEX = "uq_cycle_project_lower_name";

  /** 사이클 hard-delete (issue_cycle cascade). */
  public void delete(Long id) {
    dsl.deleteFrom(CYCLE).where(CYCLE.ID.eq(id)).execute();
  }
}
