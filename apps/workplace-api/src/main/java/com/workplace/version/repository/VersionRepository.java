package com.workplace.version.repository;

import static com.workplace.jooq.Tables.ISSUE;
import static com.workplace.jooq.Tables.ISSUE_VERSION;
import static com.workplace.jooq.Tables.PROJECT;
import static com.workplace.jooq.Tables.PROJECT_MEMBER;
import static com.workplace.jooq.Tables.PROJECT_VERSION;

import com.workplace.issue.dto.IssueStatuses;
import com.workplace.version.dto.VersionIssueCount;
import com.workplace.version.dto.VersionKind;
import com.workplace.version.dto.VersionProgress;
import com.workplace.version.dto.VersionRow;
import com.workplace.version.dto.VersionSummary;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
import org.jooq.Field;
import org.jooq.OrderField;
import org.jooq.Record;
import org.jooq.SelectField;
import org.jooq.exception.IntegrityConstraintViolationException;
import org.jooq.impl.DSL;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.stereotype.Repository;

/**
 * project_version·issue_version 의 jOOQ 저장소(WP-888). 목록 순서는 모든 곳에서 같다 — 미출시 → 출시됨 → 보관, 미출시는 출시 예정일
 * 오름차순(없으면 뒤), 출시됨·보관은 출시 예정일 내림차순(없으면 뒤, 같으면 출시 시각 내림차순), 마지막으로 이름(대소문자 무시)·id. 이름 유일(프로젝트 안, 대소문자
 * 무시)은 DB 유일 인덱스가 지키고 위반은 DuplicateKeyException 으로 바꿔 올린다.
 */
@Repository
@RequiredArgsConstructor
public class VersionRepository {

  /** 상태 순위 — 0 미출시, 1 출시됨, 2 보관. */
  private static final Field<Integer> RANK =
      DSL.when(PROJECT_VERSION.ARCHIVED_AT.isNotNull(), DSL.inline(2))
          .when(PROJECT_VERSION.RELEASED_AT.isNotNull(), DSL.inline(1))
          .otherwise(DSL.inline(0));

  /** 목록 순서(위 클래스 설명). */
  private static final List<OrderField<?>> LIST_ORDER =
      List.of(
          RANK.asc(),
          DSL.when(RANK.eq(0), PROJECT_VERSION.RELEASE_DATE).asc().nullsLast(),
          DSL.when(RANK.gt(0), PROJECT_VERSION.RELEASE_DATE).desc().nullsLast(),
          PROJECT_VERSION.RELEASED_AT.desc().nullsLast(),
          DSL.lower(PROJECT_VERSION.NAME).asc(),
          PROJECT_VERSION.ID.asc());

  private final DSLContext dsl;

  /** SELECT 결과 → VersionRow. */
  private VersionRow mapToRow(Record r) {
    return new VersionRow(
        r.get(PROJECT_VERSION.ID),
        r.get(PROJECT_VERSION.PROJECT_ID),
        r.get(PROJECT_VERSION.NAME),
        r.get(PROJECT_VERSION.DESCRIPTION),
        r.get(PROJECT_VERSION.START_DATE),
        r.get(PROJECT_VERSION.RELEASE_DATE),
        r.get(PROJECT_VERSION.RELEASED_AT),
        r.get(PROJECT_VERSION.ARCHIVED_AT),
        r.get(PROJECT_VERSION.CREATED_BY),
        r.get(PROJECT_VERSION.CREATED_AT),
        r.get(PROJECT_VERSION.UPDATED_AT));
  }

  /** 프로젝트의 버전 전체(보관 포함), 목록 순서. */
  public List<VersionRow> listByProject(long projectId) {
    return dsl.selectFrom(PROJECT_VERSION)
        .where(PROJECT_VERSION.PROJECT_ID.eq(projectId))
        .orderBy(LIST_ORDER)
        .fetch(this::mapToRow);
  }

  /** 호출자가 멤버인 모든 프로젝트의 버전(보관 포함), 목록 순서 — 프로젝트 횡단 검색(/me/issues)의 이름 필터 해석용(구성요소와 같은 범위). */
  public List<VersionRow> findByMemberProjects(long userId) {
    return dsl.selectFrom(PROJECT_VERSION)
        .where(
            PROJECT_VERSION.PROJECT_ID.in(
                dsl.select(PROJECT_MEMBER.PROJECT_ID)
                    .from(PROJECT_MEMBER)
                    .where(PROJECT_MEMBER.USER_ID.eq(userId))))
        .orderBy(LIST_ORDER)
        .fetch(this::mapToRow);
  }

  /** id 로 단건 조회(프로젝트 소속은 호출부가 확인). */
  public Optional<VersionRow> findById(long id) {
    return dsl.selectFrom(PROJECT_VERSION)
        .where(PROJECT_VERSION.ID.eq(id))
        .fetchOptional(this::mapToRow);
  }

  /** 단건 조회 + 행 잠금({@code FOR UPDATE}) — 수정이 같은 버전의 동시 변경과 겹치지 않게 한다. */
  public Optional<VersionRow> lockById(long id) {
    return dsl.selectFrom(PROJECT_VERSION)
        .where(PROJECT_VERSION.ID.eq(id))
        .forUpdate()
        .fetchOptional(this::mapToRow);
  }

  /** 프로젝트 행을 잠가(FOR NO KEY UPDATE) 버전 추가를 직렬화한다 — 상한 검사와 삽입 사이에 다른 추가가 끼지 못하게. */
  public void lockProject(long projectId) {
    dsl.select(PROJECT.ID).from(PROJECT).where(PROJECT.ID.eq(projectId)).forNoKeyUpdate().fetch();
  }

  /** 프로젝트의 버전 수(보관 포함) — 상한 검사용. */
  public int countByProject(long projectId) {
    return dsl.fetchCount(PROJECT_VERSION, PROJECT_VERSION.PROJECT_ID.eq(projectId));
  }

  /** 프로젝트 안의 id 들에 해당하는 버전(보관 포함), 목록 순서. 다른 프로젝트·없는 id 는 빠진다. */
  public List<VersionRow> findByIds(long projectId, Collection<Long> ids) {
    if (ids == null || ids.isEmpty()) return List.of();
    return dsl.selectFrom(PROJECT_VERSION)
        .where(PROJECT_VERSION.PROJECT_ID.eq(projectId).and(PROJECT_VERSION.ID.in(ids)))
        .orderBy(LIST_ORDER)
        .fetch(this::mapToRow);
  }

  /** 프로젝트 안에서 이름이 같은(대소문자 무시 — 유일 인덱스 lower(name) 과 같은 기준) 버전, 목록 순서. 보관된 것도 포함한다. */
  public List<VersionRow> findByNamesIgnoreCase(long projectId, Collection<String> names) {
    if (names == null || names.isEmpty()) return List.of();
    return dsl.selectFrom(PROJECT_VERSION)
        .where(
            PROJECT_VERSION
                .PROJECT_ID
                .eq(projectId)
                .and(
                    DSL.lower(PROJECT_VERSION.NAME)
                        .in(names.stream().map(n -> n.toLowerCase(Locale.ROOT)).toList())))
        .orderBy(LIST_ORDER)
        .fetch(this::mapToRow);
  }

  /** 버전 행 잠금 모드 — 공유(FOR SHARE)는 이슈에 붙이기, 배타(FOR UPDATE)는 출시 옮기기·삭제. */
  public enum LockMode {
    SHARE,
    UPDATE
  }

  /**
   * 버전 행을 id 순으로 잠그고 읽는다. 공유 잠금은 이슈에 붙이는 쓰기가 「보관됨 확인 → INSERT」 사이에 동시 보관·삭제가 끼지 못하게 하고, 배타 잠금은 출시
   * 옮기기·삭제용이다. 잠금은 항상 이슈 행 → 버전 행 순서, 버전끼리는 id 순서로 잡아 교착을 피한다. 읽기 전용 트랜잭션에서는 쓰지 않는다.
   */
  public List<VersionRow> lockByIds(Collection<Long> ids, LockMode mode) {
    if (ids == null || ids.isEmpty()) return List.of();
    var select =
        dsl.selectFrom(PROJECT_VERSION)
            .where(PROJECT_VERSION.ID.in(ids))
            .orderBy(PROJECT_VERSION.ID.asc());
    return (mode == LockMode.UPDATE ? select.forUpdate() : select.forShare()).fetch(this::mapToRow);
  }

  /**
   * 버전에 한 종류로 붙은 (삭제되지 않은) 이슈 id, 오름차순 — 출시 옮기기·삭제의 대상 집합. 잠그지 않는다(잠금은 {@link #lockIssues}).
   *
   * @param unresolvedOnly true 면 끝나지 않은(완료·취소 아님) 이슈만
   */
  public List<Long> issueIdsByVersion(long versionId, String kind, boolean unresolvedOnly) {
    var cond =
        ISSUE_VERSION
            .VERSION_ID
            .eq(versionId)
            .and(ISSUE_VERSION.KIND.eq(kind))
            .and(ISSUE.DELETED_AT.isNull());
    if (unresolvedOnly) cond = cond.and(ISSUE.STATUS.notIn(IssueStatuses.CLOSED));
    return dsl.select(ISSUE.ID)
        .from(ISSUE_VERSION)
        .join(ISSUE)
        .on(ISSUE.ID.eq(ISSUE_VERSION.ISSUE_ID))
        .where(cond)
        .orderBy(ISSUE.ID.asc())
        .fetch(ISSUE.ID);
  }

  /** 버전에 어느 종류로든 붙은 (삭제되지 않은) 이슈 id, 중복 없이 오름차순 — 삭제의 잠금 대상. 잠그지 않는다. */
  public List<Long> issueIdsByVersionAnyKind(long versionId) {
    return dsl.selectDistinct(ISSUE.ID)
        .from(ISSUE_VERSION)
        .join(ISSUE)
        .on(ISSUE.ID.eq(ISSUE_VERSION.ISSUE_ID))
        .where(ISSUE_VERSION.VERSION_ID.eq(versionId).and(ISSUE.DELETED_AT.isNull()))
        .orderBy(ISSUE.ID.asc())
        .fetch(ISSUE.ID);
  }

  /**
   * 이슈 행들을 id 순으로 배타 잠금({@code FOR UPDATE})한다 — 출시 옮기기·삭제가 버전 행보다 먼저 잡는다(잠금 순서 이슈 → 버전). 잠근 id 를
   * 돌려준다(그 사이 지워진 행은 빠진다).
   */
  public Set<Long> lockIssues(Collection<Long> issueIds) {
    if (issueIds == null || issueIds.isEmpty()) return Set.of();
    return new HashSet<>(
        dsl.select(ISSUE.ID)
            .from(ISSUE)
            .where(ISSUE.ID.in(issueIds))
            .orderBy(ISSUE.ID.asc())
            .forUpdate()
            .fetch(ISSUE.ID));
  }

  /** 버전에 붙은 (삭제되지 않은) 이슈 수 — 수정·영향·끝나지 않은 수정. */
  public VersionIssueCount issueCount(long versionId) {
    Field<Integer> fix = DSL.count().filterWhere(ISSUE_VERSION.KIND.eq(VersionKind.FIX));
    Field<Integer> affects = DSL.count().filterWhere(ISSUE_VERSION.KIND.eq(VersionKind.AFFECTS));
    Field<Integer> unresolved =
        DSL.count()
            .filterWhere(
                ISSUE_VERSION
                    .KIND
                    .eq(VersionKind.FIX)
                    .and(ISSUE.STATUS.notIn(IssueStatuses.CLOSED)));
    var r =
        dsl.select(fix, affects, unresolved)
            .from(ISSUE_VERSION)
            .join(ISSUE)
            .on(ISSUE.ID.eq(ISSUE_VERSION.ISSUE_ID))
            .where(ISSUE_VERSION.VERSION_ID.eq(versionId).and(ISSUE.DELETED_AT.isNull()))
            .fetchOne();
    return new VersionIssueCount(r.value1(), r.value2(), r.value3());
  }

  /** 출시 처리 — 출시일을 정하고, 출시 시각은 처음 출시할 때만 채운다(다시 출시해도 처음 시각을 유지). */
  public void release(long id, LocalDate releaseDate) {
    dsl.update(PROJECT_VERSION)
        .set(PROJECT_VERSION.RELEASE_DATE, releaseDate)
        .set(
            PROJECT_VERSION.RELEASED_AT,
            DSL.coalesce(PROJECT_VERSION.RELEASED_AT, DSL.currentOffsetDateTime()))
        .set(PROJECT_VERSION.UPDATED_AT, OffsetDateTime.now())
        .where(PROJECT_VERSION.ID.eq(id))
        .execute();
  }

  /** 출시 취소 — 출시 시각만 지우고 출시일은 남긴다. */
  public void unrelease(long id) {
    dsl.update(PROJECT_VERSION)
        .set(PROJECT_VERSION.RELEASED_AT, (OffsetDateTime) null)
        .set(PROJECT_VERSION.UPDATED_AT, OffsetDateTime.now())
        .where(PROJECT_VERSION.ID.eq(id))
        .execute();
  }

  /** 버전 행 삭제 — 남은 연결(삭제된 이슈의 것)은 외래키 cascade 로 함께 지워진다. */
  public void delete(long id) {
    dsl.deleteFrom(PROJECT_VERSION).where(PROJECT_VERSION.ID.eq(id)).execute();
  }

  /** 이름 유일 인덱스(uq_project_version_name) 위반의 PG SQLState. */
  private static final String UNIQUE_VIOLATION = "23505";

  /**
   * 무결성 위반을 옮긴다 — 이름 유일 인덱스 위반만 DuplicateKeyException(이름 중복)으로 바꾸고, 그 밖의 위반(CHECK·FK 등)은 이름 중복으로 잘못
   * 알리지 않도록 그대로 다시 던진다.
   */
  private static RuntimeException translate(IntegrityConstraintViolationException e) {
    String msg = e.getMessage();
    if (UNIQUE_VIOLATION.equals(e.sqlState())
        && msg != null
        && msg.contains("uq_project_version_name")) {
      return new DuplicateKeyException("version name duplicated", e);
    }
    return e;
  }

  /** 신규 버전 삽입. 이름 중복은 DuplicateKeyException. */
  public VersionRow insert(
      long projectId,
      String name,
      String description,
      LocalDate startDate,
      LocalDate releaseDate,
      Long createdBy) {
    try {
      return dsl.insertInto(PROJECT_VERSION)
          .set(PROJECT_VERSION.PROJECT_ID, projectId)
          .set(PROJECT_VERSION.NAME, name)
          .set(PROJECT_VERSION.DESCRIPTION, description)
          .set(PROJECT_VERSION.START_DATE, startDate)
          .set(PROJECT_VERSION.RELEASE_DATE, releaseDate)
          .set(PROJECT_VERSION.CREATED_BY, createdBy)
          .returning()
          .fetchOptional()
          .map(this::mapToRow)
          .orElseThrow(() -> new IllegalStateException("INSERT RETURNING 결과 없음"));
    } catch (IntegrityConstraintViolationException e) {
      throw translate(e);
    }
  }

  /**
   * 이름·설명·날짜·보관 여부를 한 번에 갱신(호출부가 최종 값을 계산해 넘긴다). 출시 시각은 건드리지 않아 보관·복원이 출시 상태를 보존한다. 이름 중복은
   * DuplicateKeyException.
   */
  public void update(
      long id,
      String name,
      String description,
      LocalDate startDate,
      LocalDate releaseDate,
      boolean archived) {
    try {
      dsl.update(PROJECT_VERSION)
          .set(PROJECT_VERSION.NAME, name)
          .set(PROJECT_VERSION.DESCRIPTION, description)
          .set(PROJECT_VERSION.START_DATE, startDate)
          .set(PROJECT_VERSION.RELEASE_DATE, releaseDate)
          // 이미 보관된 것을 다시 보관해도 보관 시각이 밀리지 않게 기존 값을 유지한다.
          .set(
              PROJECT_VERSION.ARCHIVED_AT,
              archived
                  ? DSL.coalesce(PROJECT_VERSION.ARCHIVED_AT, DSL.currentOffsetDateTime())
                  : DSL.val((OffsetDateTime) null))
          .set(PROJECT_VERSION.UPDATED_AT, OffsetDateTime.now())
          .where(PROJECT_VERSION.ID.eq(id))
          .execute();
    } catch (IntegrityConstraintViolationException e) {
      throw translate(e);
    }
  }

  /** 한 이슈의 수정·영향 버전 요약 쌍(각각 버전 목록 순서). */
  public record IssueVersionSummaries(List<VersionSummary> fix, List<VersionSummary> affects) {
    /** 버전이 하나도 없는 이슈용 빈 쌍. */
    public static final IssueVersionSummaries EMPTY =
        new IssueVersionSummaries(List.of(), List.of());
  }

  /**
   * 이슈 id 들 → 이슈별 수정·영향 버전 요약을 한 쿼리로 읽는다(상세·검색·응답 경로의 왕복 절반). 종류는 메모리에서 나누며 목록 순서를 유지한다. 버전이 없는 이슈는
   * 맵에 없다.
   */
  public Map<Long, IssueVersionSummaries> summariesByIssueIdsBothKinds(Collection<Long> issueIds) {
    if (issueIds == null || issueIds.isEmpty()) return Map.of();
    var out = new LinkedHashMap<Long, IssueVersionSummaries>();
    List<SelectField<?>> selectFields = new ArrayList<>();
    selectFields.add(ISSUE_VERSION.ISSUE_ID);
    selectFields.add(ISSUE_VERSION.KIND);
    selectFields.addAll(List.of(PROJECT_VERSION.fields()));
    dsl.select(selectFields)
        .from(ISSUE_VERSION)
        .join(PROJECT_VERSION)
        .on(PROJECT_VERSION.ID.eq(ISSUE_VERSION.VERSION_ID))
        .where(ISSUE_VERSION.ISSUE_ID.in(issueIds))
        .orderBy(LIST_ORDER)
        .forEach(
            r -> {
              // 이슈별 쌍을 처음 만날 때 빈 목록 둘로 만들고, 종류에 맞는 쪽에 목록 순서대로 더한다.
              var pair =
                  out.computeIfAbsent(
                      r.get(ISSUE_VERSION.ISSUE_ID),
                      k -> new IssueVersionSummaries(new ArrayList<>(), new ArrayList<>()));
              (VersionKind.isFix(r.get(ISSUE_VERSION.KIND)) ? pair.fix() : pair.affects())
                  .add(mapToRow(r).toSummary());
            });
    return out;
  }

  /** 버전별 집계 — 수정 버전 이슈 진행과 영향 버전 이슈 수. */
  public record VersionTallies(Map<Long, VersionProgress> progress, Map<Long, Integer> affects) {}

  /**
   * 버전별 수정 버전(FIX) 이슈 진행과 영향 버전(AFFECTS) 이슈 수를 한 번의 그룹 쿼리로 집계한다 — (삭제되지 않은) 이슈만 센다. 진행은 상태 범주로 나누고
   * 취소는 완료로 센다({@link IssueStatuses#CLOSED}, 사이클 진행과 같은 기준). 영향 수는 취소 포함. 붙은 이슈가 없는 버전은 두 맵에 없다.
   */
  public VersionTallies talliesByVersionIds(Collection<Long> versionIds) {
    if (versionIds == null || versionIds.isEmpty()) return new VersionTallies(Map.of(), Map.of());
    var isFix = ISSUE_VERSION.KIND.eq(VersionKind.FIX);
    Field<Integer> fixTotal = DSL.count().filterWhere(isFix);
    Field<Integer> done = DSL.count().filterWhere(isFix.and(ISSUE.STATUS.in(IssueStatuses.CLOSED)));
    Field<Integer> inProgress =
        DSL.count().filterWhere(isFix.and(ISSUE.STATUS.eq(IssueStatuses.IN_PROGRESS)));
    Field<Integer> affects = DSL.count().filterWhere(ISSUE_VERSION.KIND.eq(VersionKind.AFFECTS));
    var progress = new HashMap<Long, VersionProgress>();
    var affectsCount = new HashMap<Long, Integer>();
    dsl.select(ISSUE_VERSION.VERSION_ID, fixTotal, done, inProgress, affects)
        .from(ISSUE_VERSION)
        .join(ISSUE)
        .on(ISSUE.ID.eq(ISSUE_VERSION.ISSUE_ID))
        .where(ISSUE_VERSION.VERSION_ID.in(versionIds).and(ISSUE.DELETED_AT.isNull()))
        .groupBy(ISSUE_VERSION.VERSION_ID)
        .forEach(
            r -> {
              long id = r.value1();
              // 할 일은 전체에서 완료·진행 중을 뺀 나머지 — 그 밖의 모든 상태(범주 밖 값 포함)를 할 일로 센다.
              if (r.value2() > 0) {
                progress.put(
                    id,
                    new VersionProgress(
                        r.value3(), r.value4(), r.value2() - r.value3() - r.value4()));
              }
              if (r.value5() > 0) affectsCount.put(id, r.value5());
            });
    return new VersionTallies(progress, affectsCount);
  }
}
