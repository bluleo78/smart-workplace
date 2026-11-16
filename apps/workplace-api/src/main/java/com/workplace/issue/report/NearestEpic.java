package com.workplace.issue.report;

import static com.workplace.jooq.Tables.ISSUE;
import static com.workplace.jooq.Tables.ISSUE_TYPE_DEF;

import org.jooq.Field;
import org.jooq.Table;
import org.jooq.impl.DSL;

/**
 * 이슈의 가장 가까운 EPIC 조상(부모 → 조부모 → 증조부모, 최대 3단계) — 프로젝트 리포트(WP-1629)와 개인 보고의 끝낸 일 집계(WP-1632)가 같은 규칙으로
 * 「에픽 → 스토리 → 하위 작업」 의 하위 작업까지 에픽 하위로 세게 한 곳에 둔다. 삭제된 조상은 따라가지 않는다(그 위 에픽도 끊긴 것으로 본다).
 *
 * <p>{@link #table} 은 {@code ISSUE} 에 조상·조상 유형 별칭을 left join 한 테이블이라 {@code .from(ne.table())} 뒤에
 * 다른 조인을 이어 붙인다. 별칭은 접두로 나눠 한 쿼리 안 다른 ISSUE 별칭과 겹치지 않게 한다.
 *
 * @param table ISSUE + 조상 left join
 * @param epicId 가장 가까운 EPIC 조상 id 식(별칭 없음, 없으면 NULL) — select 에 쓸 때는 호출자가 {@code .as(...)} 로 이름을
 *     붙인다
 */
record NearestEpic(Table<?> table, Field<Long> epicId) {

  /**
   * 별칭 접두를 받아 조상 사슬을 만든다.
   *
   * @param aliasPrefix 별칭 접두(예: {@code rpe_}) — 같은 쿼리의 다른 별칭과 겹치지 않게
   */
  static NearestEpic of(String aliasPrefix) {
    var p1 = ISSUE.as(aliasPrefix + "p1");
    var p2 = ISSUE.as(aliasPrefix + "p2");
    var p3 = ISSUE.as(aliasPrefix + "p3");
    var t1 = ISSUE_TYPE_DEF.as(aliasPrefix + "t1");
    var t2 = ISSUE_TYPE_DEF.as(aliasPrefix + "t2");
    var t3 = ISSUE_TYPE_DEF.as(aliasPrefix + "t3");
    String epic = ProjectReportEpicRepository.EPIC_TYPE;
    // 가까운 조상부터 — 부모가 에픽이면 부모, 아니면 조부모, 아니면 증조부모(최대 3단계).
    Field<Long> epicExpr =
        DSL.when(t1.NAME.eq(epic), p1.ID)
            .when(t2.NAME.eq(epic), p2.ID)
            .when(t3.NAME.eq(epic), p3.ID);
    Table<?> table =
        ISSUE
            .leftJoin(p1)
            .on(p1.ID.eq(ISSUE.PARENT_ISSUE_ID).and(p1.DELETED_AT.isNull()))
            .leftJoin(t1)
            .on(t1.ID.eq(p1.TYPE_ID))
            .leftJoin(p2)
            .on(p2.ID.eq(p1.PARENT_ISSUE_ID).and(p2.DELETED_AT.isNull()))
            .leftJoin(t2)
            .on(t2.ID.eq(p2.TYPE_ID))
            .leftJoin(p3)
            .on(p3.ID.eq(p2.PARENT_ISSUE_ID).and(p3.DELETED_AT.isNull()))
            .leftJoin(t3)
            .on(t3.ID.eq(p3.TYPE_ID));
    return new NearestEpic(table, epicExpr);
  }
}
