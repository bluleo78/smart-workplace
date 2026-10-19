package com.workplace.issue.repository;

import static com.workplace.jooq.Tables.ISSUE;
import static com.workplace.jooq.Tables.ISSUE_LABEL;
import static com.workplace.jooq.Tables.LABEL;

import com.workplace.label.dto.LabelSummary;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;
import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
import org.springframework.stereotype.Repository;

/** issue ↔ label N:M jOOQ 리포지토리. */
@Repository
@RequiredArgsConstructor
public class IssueLabelRepository {

  private final DSLContext dsl;

  /** 이슈에 부착된 라벨 ID 집합. */
  public List<Long> findLabelIdsByIssue(Long issueId) {
    return dsl.select(ISSUE_LABEL.LABEL_ID)
        .from(ISSUE_LABEL)
        .where(ISSUE_LABEL.ISSUE_ID.eq(issueId))
        .fetch(ISSUE_LABEL.LABEL_ID);
  }

  /** 이슈에 부착된 라벨 요약 — name/colorToken 조인 포함. */
  public List<LabelSummary> findLabelsByIssue(Long issueId) {
    return dsl.select(LABEL.ID, LABEL.NAME, LABEL.COLOR_TOKEN)
        .from(ISSUE_LABEL)
        .join(LABEL)
        .on(LABEL.ID.eq(ISSUE_LABEL.LABEL_ID))
        .where(ISSUE_LABEL.ISSUE_ID.eq(issueId))
        .orderBy(LABEL.NAME.asc())
        .fetch(r -> new LabelSummary(r.get(LABEL.ID), r.get(LABEL.NAME), r.get(LABEL.COLOR_TOKEN)));
  }

  /** issueId 집합 → issueId 별 LabelSummary 리스트 (검색 결과 N+1 방지). */
  public Map<Long, List<LabelSummary>> findLabelsByIssueIds(List<Long> issueIds) {
    if (issueIds == null || issueIds.isEmpty()) return Map.of();
    var rows =
        dsl.select(ISSUE_LABEL.ISSUE_ID, LABEL.ID, LABEL.NAME, LABEL.COLOR_TOKEN)
            .from(ISSUE_LABEL)
            .join(LABEL)
            .on(LABEL.ID.eq(ISSUE_LABEL.LABEL_ID))
            .where(ISSUE_LABEL.ISSUE_ID.in(issueIds))
            .orderBy(LABEL.NAME.asc())
            .fetch();
    return rows.stream()
        .collect(
            Collectors.groupingBy(
                r -> r.get(ISSUE_LABEL.ISSUE_ID),
                Collectors.mapping(
                    r ->
                        new LabelSummary(
                            r.get(LABEL.ID), r.get(LABEL.NAME), r.get(LABEL.COLOR_TOKEN)),
                    Collectors.toList())));
  }

  /** 라벨 1건 부착 — 중복은 무시. */
  public void add(Long issueId, Long labelId) {
    dsl.insertInto(ISSUE_LABEL)
        .set(ISSUE_LABEL.ISSUE_ID, issueId)
        .set(ISSUE_LABEL.LABEL_ID, labelId)
        .onConflictDoNothing()
        .execute();
  }

  /** 라벨 1건 제거. */
  public void remove(Long issueId, Long labelId) {
    dsl.deleteFrom(ISSUE_LABEL)
        .where(ISSUE_LABEL.ISSUE_ID.eq(issueId).and(ISSUE_LABEL.LABEL_ID.eq(labelId)))
        .execute();
  }

  /** 이 라벨이 붙은 이슈 id — 라벨 삭제(cascade) 전에 읽어 이슈 이력에 「라벨 제거」를 남긴다(WP-488). */
  public List<Long> findIssueIdsByLabel(Long labelId) {
    return dsl.select(ISSUE_LABEL.ISSUE_ID)
        .from(ISSUE_LABEL)
        .where(ISSUE_LABEL.LABEL_ID.eq(labelId))
        .fetch(ISSUE_LABEL.ISSUE_ID);
  }

  /** 이 라벨이 붙은 (삭제되지 않은) 이슈 수 — 라벨 삭제 확인창의 영향 안내(WP-488). */
  public int countLiveIssuesByLabel(Long labelId) {
    return dsl.fetchCount(
        ISSUE_LABEL.join(ISSUE).on(ISSUE.ID.eq(ISSUE_LABEL.ISSUE_ID)),
        ISSUE_LABEL.LABEL_ID.eq(labelId),
        ISSUE.DELETED_AT.isNull());
  }
}
