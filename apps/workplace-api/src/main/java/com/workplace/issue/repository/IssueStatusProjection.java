package com.workplace.issue.repository;

import static com.workplace.jooq.Tables.PROJECT_STATUS;

import com.workplace.jooq.tables.Issue;
import java.util.Arrays;
import org.jooq.Field;
import org.jooq.SelectField;
import org.jooq.Table;

/**
 * 이슈의 사용자 정의 상태 필드(status_id·이름·색) 조인과 컬럼을 한 곳에 모은다(WP-937). 이슈 행(IssueRow)·부모 요약(ParentRef)·의존 요약
 * (IssueLinkSummary) 조회가 같은 LEFT JOIN·같은 별칭을 쓰게 해, 상태 필드가 바뀌어도 한 곳만 고친다. 이슈 테이블은 별칭(부모 p 등)일 수 있어
 * 인자로 받는다.
 */
final class IssueStatusProjection {

  private IssueStatusProjection() {}

  /** 프로젝트 상태 이름 — {@link #leftJoin} 조인 컬럼(WP-807 → WP-870). */
  static final Field<String> STATUS_NAME = PROJECT_STATUS.NAME.as("status_name");

  /** 프로젝트 상태 색 토큰 — {@link #leftJoin} 조인 컬럼(WP-870). */
  static final Field<String> STATUS_COLOR = PROJECT_STATUS.COLOR.as("status_color");

  /**
   * {@code from} 에 이슈 {@code issue} 의 프로젝트 상태를 LEFT JOIN 한다 — status_id 가 비어도 행이 남게 외부 조인이다. 잠그는
   * 조회는 이 조인을 통해 잠그지 않는다(WP-1420): issue 만 잠근 뒤 이 조인을 잠금 없이 다시 읽는다 — 한 문장으로 잠그면 잠금을 기다린 뒤 상태 이름·색이
   * null 로 빠진다. (배경: nullable 쪽 잠금은 PostgreSQL 이 거절하고, inner JOIN 으로 상태 행까지 잠그면 상태 삭제와 교착될 수 있다.)
   * {@link IssueRepository#ISSUE_WITH_STATUS} 참고.
   */
  static Table<?> leftJoin(Table<?> from, Issue issue) {
    return from.leftJoin(PROJECT_STATUS).on(PROJECT_STATUS.ID.eq(issue.STATUS_ID));
  }

  /** 이슈 테이블 하나에 그 상태를 LEFT JOIN 한다 — 앞에 다른 조인이 없을 때의 {@link #leftJoin(Table, Issue)}. */
  static Table<?> leftJoin(Issue issue) {
    return leftJoin(issue, issue);
  }

  /** 앞 컬럼들 뒤에 상태 3필드(status_id·이름·색)를 붙인 SELECT 목록 — {@link #leftJoin} 과 함께 쓴다. */
  static SelectField<?>[] withFields(Issue issue, SelectField<?>... head) {
    SelectField<?>[] all = Arrays.copyOf(head, head.length + 3);
    all[head.length] = issue.STATUS_ID;
    all[head.length + 1] = STATUS_NAME;
    all[head.length + 2] = STATUS_COLOR;
    return all;
  }
}
