package com.workplace.issue.repository;

import static com.workplace.jooq.Tables.ISSUE;
import static com.workplace.jooq.Tables.ISSUE_RELATION;
import static com.workplace.jooq.Tables.ISSUE_TYPE_DEF;
import static com.workplace.jooq.Tables.PROJECT;
import static com.workplace.jooq.Tables.PROJECT_MEMBER;
import static org.jooq.impl.DSL.exists;
import static org.jooq.impl.DSL.inline;
import static org.jooq.impl.DSL.selectOne;
import static org.jooq.impl.DSL.trueCondition;
import static org.jooq.impl.DSL.when;

import com.workplace.issue.dto.IssueLookupItem;
import com.workplace.issue.dto.IssueStatuses;
import com.workplace.issue.dto.IssueTypeSummary;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.jooq.Condition;
import org.jooq.DSLContext;
import org.jooq.Field;
import org.jooq.SortField;
import org.springframework.stereotype.Repository;

/**
 * 이슈 사이 관계(issue_relation, WP-887) jOOQ 리포지토리 — 관계 넣기·지우기, 이슈 상세의 관계 목록, 관계 대상 찾기(lookup). 차단은 여기
 * 없다 (issue_dependency 그대로). 모든 조회는 RLS 가 현재 워크스페이스로 한정한다.
 */
@Repository
@RequiredArgsConstructor
public class IssueRelationRepository {

  private final DSLContext dsl;

  /** 저장된 관계 한 행 — source 가 A 쪽(방향 없는 유형은 source &lt; target 으로 정규화돼 있다). */
  public record RelationRow(long id, long typeId, long sourceIssueId, long targetIssueId) {}

  /**
   * 이슈 상세 관계 목록의 한 행 — 이 이슈 기준으로 본 상대 정보. 상대는 삭제되지 않은 이슈·프로젝트만 온다(읽기 권한 거르기는 서비스가 한다).
   *
   * @param thisIsSource 이 이슈가 A(source) 쪽인가 — 표시 말을 고른다
   * @param otherStatus 상대 상태 범주
   */
  public record LinkedRow(
      long id,
      long typeId,
      boolean thisIsSource,
      long otherProjectId,
      String otherProjectKey,
      int otherNumber,
      String otherTitle,
      String otherStatus,
      IssueTypeSummary otherType) {}

  /**
   * 관계 한 줄을 넣는다 — 같은 (유형, source, target) 이 이미 있으면 그대로 둔다(ON CONFLICT DO NOTHING). 방향 없는 유형의 정규화는
   * 호출자 몫이다({@code IssueRelationService.StoredPair}). 가져오기(관계 일괄)도 이 메서드를 쓴다.
   *
   * @return 새로 넣었으면 true, 이미 있어 건너뛰었으면 false — 이력·실시간 신호를 낼지 이 값으로 가른다(동시 요청에도 한 번만 남게)
   */
  public boolean insertIfAbsent(
      long typeId, long sourceIssueId, long targetIssueId, Long createdBy) {
    return dsl.insertInto(ISSUE_RELATION)
            .set(ISSUE_RELATION.TYPE_ID, typeId)
            .set(ISSUE_RELATION.SOURCE_ISSUE_ID, sourceIssueId)
            .set(ISSUE_RELATION.TARGET_ISSUE_ID, targetIssueId)
            .set(ISSUE_RELATION.CREATED_BY, createdBy)
            .onConflictDoNothing()
            .execute()
        > 0;
  }

  /** id 로 관계 한 행. */
  public Optional<RelationRow> findById(long id) {
    return dsl.select(
            ISSUE_RELATION.ID,
            ISSUE_RELATION.TYPE_ID,
            ISSUE_RELATION.SOURCE_ISSUE_ID,
            ISSUE_RELATION.TARGET_ISSUE_ID)
        .from(ISSUE_RELATION)
        .where(ISSUE_RELATION.ID.eq(id))
        .fetchOptional(r -> new RelationRow(r.value1(), r.value2(), r.value3(), r.value4()));
  }

  /** id 로 관계를 지운다 — 지운 행 수(0 이면 이미 없음 → 이력·신호를 내지 않는다). */
  public int deleteById(long id) {
    return dsl.deleteFrom(ISSUE_RELATION).where(ISSUE_RELATION.ID.eq(id)).execute();
  }

  /**
   * 이 이슈가 어느 쪽 끝이든 걸린 관계를 상대 이슈 정보와 함께 한 번에 읽는다(N+1 없음). 상대 이슈나 그 프로젝트가 삭제됐으면 빠진다 — 행은 남아 있어도 어디에도
   * 보이지 않는다(의존성과 같은 규칙).
   */
  public List<LinkedRow> findLinkedTo(long issueId) {
    var other = ISSUE.as("rel_other");
    Field<Long> otherId =
        when(ISSUE_RELATION.SOURCE_ISSUE_ID.eq(issueId), ISSUE_RELATION.TARGET_ISSUE_ID)
            .otherwise(ISSUE_RELATION.SOURCE_ISSUE_ID);
    return dsl.select(
            ISSUE_RELATION.ID,
            ISSUE_RELATION.TYPE_ID,
            ISSUE_RELATION.SOURCE_ISSUE_ID,
            PROJECT.ID,
            PROJECT.KEY,
            other.NUMBER,
            other.TITLE,
            other.STATUS,
            ISSUE_TYPE_DEF.ID,
            ISSUE_TYPE_DEF.NAME,
            ISSUE_TYPE_DEF.COLOR_TOKEN,
            ISSUE_TYPE_DEF.ICON)
        .from(ISSUE_RELATION)
        .join(other)
        .on(other.ID.eq(otherId))
        .join(PROJECT)
        .on(PROJECT.ID.eq(other.PROJECT_ID))
        .join(ISSUE_TYPE_DEF)
        .on(ISSUE_TYPE_DEF.ID.eq(other.TYPE_ID))
        .where(
            ISSUE_RELATION
                .SOURCE_ISSUE_ID
                .eq(issueId)
                .or(ISSUE_RELATION.TARGET_ISSUE_ID.eq(issueId))
                .and(other.DELETED_AT.isNull())
                .and(PROJECT.DELETED_AT.isNull()))
        .fetch(
            r ->
                new LinkedRow(
                    r.get(ISSUE_RELATION.ID),
                    r.get(ISSUE_RELATION.TYPE_ID),
                    r.get(ISSUE_RELATION.SOURCE_ISSUE_ID) == issueId,
                    r.get(PROJECT.ID),
                    r.get(PROJECT.KEY),
                    r.get(other.NUMBER),
                    r.get(other.TITLE),
                    r.get(other.STATUS),
                    new IssueTypeSummary(
                        r.get(ISSUE_TYPE_DEF.ID),
                        r.get(ISSUE_TYPE_DEF.NAME),
                        r.get(ISSUE_TYPE_DEF.COLOR_TOKEN),
                        r.get(ISSUE_TYPE_DEF.ICON))));
  }

  // ── 관계 대상 찾기(lookup) ───────────────────────────────────────────────────────────────

  /**
   * 찾기 범위 — 현재 이슈와 실제로 걸 수 있는 이슈만 보이게 한다. 개인 프로젝트 이슈는 같은 프로젝트 안에서만 관계를 맺는다.
   *
   * @param callerId 호출자
   * @param callerIsAdmin 호출자가 ADMIN 인가(역할 테이블을 보는 서비스가 넘긴다) — TEAM 프로젝트 읽기 우회
   * @param personalProjectId 현재 이슈가 개인 프로젝트면 그 id(그 프로젝트만 찾는다), 아니면 null(읽을 수 있는 비개인 프로젝트 전부)
   * @param typeName 유형 이름(예: EPIC)으로 좁힌다 — null 이면 모든 유형. 유형은 프로젝트마다 따로라 이름으로 맞춘다(WP-1039 다른 프로젝트
   *     에픽 고르기 — 화면에서 거르면 20건 상한에 다른 유형이 차 에픽이 밀려났다)
   * @param openOnly 참이면 종료(완료·취소 범주) 이슈를 뺀다 — 닫힌 에픽은 상위 에픽으로 고를 대상이 아니다
   * @param excludeProjectKey 이 프로젝트(대문자 키)의 이슈를 뺀다. null 이면 빼지 않는다 — 다른 프로젝트 에픽만 찾을 때 같은 프로젝트 행이
   *     상한을 차지하지 않게 한다
   */
  public record LookupScope(
      long callerId,
      boolean callerIsAdmin,
      Long personalProjectId,
      String typeName,
      boolean openOnly,
      String excludeProjectKey) {}

  /** 키 정확 일치({@code WPV-28}) — projectKey 는 대문자로 정규화해 넘긴다. */
  public List<IssueLookupItem> lookupByKey(
      String projectKey, int number, LookupScope scope, int limit) {
    return lookup(PROJECT.KEY.eq(projectKey).and(ISSUE.NUMBER.eq(number)), scope, limit, List.of());
  }

  /**
   * 번호({@code #12}) — 범위 안 프로젝트들에서 그 번호. preferredProjectKey(현재 이슈의 프로젝트)의 그 번호가 맨 앞에 온다 — 같은 번호가
   * 여러 프로젝트에 있어 limit 에서 잘려도 빠지지 않게 정렬을 SQL 에서 한다. 범위 밖 프로젝트는 WHERE 가 이미 걸러 순서로 존재가 드러나지 않는다.
   *
   * @param preferredProjectKey 대문자 프로젝트 키. null 이면 앞세우지 않는다
   */
  public List<IssueLookupItem> lookupByNumber(
      int number, String preferredProjectKey, LookupScope scope, int limit) {
    List<SortField<?>> order = new ArrayList<>();
    if (preferredProjectKey != null) {
      order.add(when(PROJECT.KEY.eq(preferredProjectKey), inline(0)).otherwise(inline(1)).asc());
    }
    return lookup(ISSUE.NUMBER.eq(number), scope, limit, order);
  }

  /** 제목 부분 일치(대소문자 무시) — likePattern 은 와일드카드가 이스케이프된 {@code %…%} 꼴이어야 한다(역슬래시 이스케이프). */
  public List<IssueLookupItem> lookupByTitle(String likePattern, LookupScope scope, int limit) {
    return lookup(ISSUE.TITLE.likeIgnoreCase(likePattern, '\\'), scope, limit, List.of());
  }

  /** 찾기 공통 — 읽을 수 있는 프로젝트의 활성 이슈 중 match 를 (앞세울 순서 →) 최신 수정순으로 limit 건. */
  private List<IssueLookupItem> lookup(
      Condition match, LookupScope scope, int limit, List<SortField<?>> leadingOrder) {
    List<SortField<?>> order = new ArrayList<>(leadingOrder);
    order.add(ISSUE.UPDATED_AT.desc());
    order.add(ISSUE.ID.desc());
    return dsl.select(
            PROJECT.KEY,
            ISSUE.NUMBER,
            ISSUE.TITLE,
            ISSUE.STATUS,
            ISSUE_TYPE_DEF.ID,
            ISSUE_TYPE_DEF.NAME,
            ISSUE_TYPE_DEF.COLOR_TOKEN,
            ISSUE_TYPE_DEF.ICON)
        .from(ISSUE)
        .join(PROJECT)
        .on(PROJECT.ID.eq(ISSUE.PROJECT_ID))
        .join(ISSUE_TYPE_DEF)
        .on(ISSUE_TYPE_DEF.ID.eq(ISSUE.TYPE_ID))
        .where(
            ISSUE
                .DELETED_AT
                .isNull()
                .and(PROJECT.DELETED_AT.isNull())
                .and(scopeCondition(scope))
                .and(filterCondition(scope))
                .and(match))
        .orderBy(order)
        .limit(limit)
        .fetch(
            r ->
                new IssueLookupItem(
                    r.get(PROJECT.KEY),
                    r.get(ISSUE.NUMBER),
                    r.get(ISSUE.TITLE),
                    r.get(ISSUE.STATUS),
                    new IssueTypeSummary(
                        r.get(ISSUE_TYPE_DEF.ID),
                        r.get(ISSUE_TYPE_DEF.NAME),
                        r.get(ISSUE_TYPE_DEF.COLOR_TOKEN),
                        r.get(ISSUE_TYPE_DEF.ICON))));
  }

  /** 유형·열린 상태·제외 프로젝트 거름(WP-1039) — limit 전에 SQL 로 걸어야 20건 상한 안에서 밀려나지 않는다. */
  private Condition filterCondition(LookupScope scope) {
    Condition c = trueCondition();
    if (scope.typeName() != null) {
      c = c.and(ISSUE_TYPE_DEF.NAME.eq(scope.typeName()));
    }
    if (scope.openOnly()) {
      c = c.and(ISSUE.STATUS.notIn(IssueStatuses.CLOSED));
    }
    if (scope.excludeProjectKey() != null) {
      c = c.and(PROJECT.KEY.ne(scope.excludeProjectKey()));
    }
    return c;
  }

  /**
   * 찾기 범위 조건. 개인 프로젝트 id 가 있으면 그 프로젝트만(읽기 확인은 서비스가 했다). 없으면 {@code ProjectAccessGuard.canRead} 의
   * 비개인 부분을 SQL 로 — OPEN 은 누구나, 그 밖의 공유 프로젝트(TEAM)는 멤버 또는 ADMIN. 개인 프로젝트는 다른 프로젝트와 관계를 못 맺으므로 뺀다.
   */
  private Condition scopeCondition(LookupScope scope) {
    if (scope.personalProjectId() != null) {
      return PROJECT.ID.eq(scope.personalProjectId());
    }
    Condition member =
        exists(
            selectOne()
                .from(PROJECT_MEMBER)
                .where(
                    PROJECT_MEMBER
                        .PROJECT_ID
                        .eq(PROJECT.ID)
                        .and(PROJECT_MEMBER.USER_ID.eq(scope.callerId()))));
    return PROJECT
        .TYPE
        .ne("PERSONAL")
        .and(PROJECT.TYPE.eq("OPEN").or(scope.callerIsAdmin() ? trueCondition() : member));
  }
}
