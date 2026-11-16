package com.workplace.issue.report;

import static com.workplace.jooq.Tables.ISSUE;
import static com.workplace.jooq.Tables.ISSUE_LABEL;
import static com.workplace.jooq.Tables.LABEL;

import java.util.ArrayList;
import java.util.Collection;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.jooq.Condition;
import org.jooq.DSLContext;
import org.jooq.impl.DSL;

/**
 * 리포트용 라벨 조회(WP-1632) — 「상시」·「AI 탐색」 처럼 이름으로 뜻을 정한 라벨이 붙은 이슈 id 를 읽는다. 프로젝트 리포트(WP-1629)와 개인 보고 끝낸
 * 일 집계가 같은 규칙(이슈 라벨 → 라벨 이름, 라벨 범위 조건)으로 읽도록 한 곳에 뒀다. 여러 이름을 한 쿼리로 읽는다(리뷰 — 이름마다 쿼리를 따로 내지 않게).
 */
final class ReportLabels {

  private ReportLabels() {}

  /**
   * 라벨 이름마다, 그 라벨이 붙고 이름별 이슈 조건을 통과하는 이슈 id — 한 쿼리.
   *
   * <p>이름마다 볼 이슈가 달라서(예: 「상시」 는 에픽만, 「AI 탐색」 은 이번 기간 끝낸 이슈만) 이름별 조건을 받는다. SQL 은 {@code labelScope
   * AND ((name = a AND 조건a) OR (name = b AND 조건b) …)} 하나다.
   *
   * @param dsl jOOQ — RLS 보호 테이블이라 트랜잭션 안에서 부른다
   * @param labelScope 어떤 라벨을 볼지(예: {@code LABEL.PROJECT_ID.eq(ISSUE.PROJECT_ID)} — 이슈 프로젝트의 라벨만, 또는
   *     {@code LABEL.PROJECT_ID.eq(pid)}). ISSUE·LABEL 이 조인된 상태로 건다
   * @param issueConditionByName 라벨 이름 → 그 이름에서 볼 이슈 조건(ISSUE 기준, 제한 없으면 {@link DSL#noCondition()}).
   *     비면 쿼리 없이 빈 맵
   * @return 받은 이름마다의 이슈 id 집합(붙은 이슈가 없으면 빈 집합 — 늘 모든 이름이 들어 있다)
   */
  static Map<String, Set<Long>> issueIdsWithLabels(
      DSLContext dsl, Condition labelScope, Map<String, Condition> issueConditionByName) {
    Map<String, Set<Long>> out = new LinkedHashMap<>();
    issueConditionByName.keySet().forEach(n -> out.put(n, new HashSet<>()));
    if (issueConditionByName.isEmpty()) return out;
    List<Condition> perName = new ArrayList<>();
    issueConditionByName.forEach((name, cond) -> perName.add(LABEL.NAME.eq(name).and(cond)));
    dsl.selectDistinct(ISSUE_LABEL.ISSUE_ID, LABEL.NAME)
        .from(ISSUE_LABEL)
        .join(LABEL)
        .on(LABEL.ID.eq(ISSUE_LABEL.LABEL_ID))
        .join(ISSUE)
        .on(ISSUE.ID.eq(ISSUE_LABEL.ISSUE_ID))
        .where(labelScope)
        .and(DSL.or(perName))
        .fetch()
        .forEach(r -> out.get(r.value2()).add(r.value1()));
    return out;
  }

  /** 이슈 id 가 주어진 것 중 하나인가 — 비면 거짓(빈 배열 ANY 와 같지만 뜻을 드러낸다). 이름별 조건을 만들 때 쓴다. */
  static Condition issueIdIn(Collection<Long> ids) {
    return ids.isEmpty() ? DSL.falseCondition() : ISSUE.ID.eq(DSL.any(ids.toArray(Long[]::new)));
  }
}
