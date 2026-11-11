package com.workplace.issue.profile;

import static com.workplace.jooq.Tables.ISSUE;
import static com.workplace.jooq.Tables.ISSUE_COMMENT;
import static com.workplace.jooq.Tables.ISSUE_COMPONENT;
import static com.workplace.jooq.Tables.ISSUE_TYPE_DEF;
import static com.workplace.jooq.Tables.PROJECT;
import static com.workplace.jooq.Tables.PROJECT_COMPONENT;

import java.time.OffsetDateTime;
import java.util.Collection;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;
import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
import org.springframework.stereotype.Repository;

/**
 * 업무 프로파일 AI 입력 모으기(WP-1485) — 끝낸 이슈의 표시 정보·구성요소·마지막 코멘트를 이슈 수와 무관하게 종류마다 쿼리 1개로 읽는다(N+1 금지). 라벨은
 * 기존 {@code IssueLabelRepository#findLabelsByIssueIds} 를 쓴다.
 *
 * <p>RLS 보호 테이블이라 반드시 트랜잭션 안에서 부른다.
 */
@Repository
@RequiredArgsConstructor
public class WorkProfileInputRepository {

  private final DSLContext dsl;

  /**
   * 이슈 한 건의 AI 입력용 표시 정보.
   *
   * @param key 이슈 키(PROJECT.KEY-NUMBER)
   * @param body 본문 원문(자르기는 서비스가 한다). 없으면 null
   * @param typeName 유형 이름(TASK·BUG·EPIC 등)
   * @param epicTitle 부모가 에픽이면 그 제목, 아니면 null
   * @param updatedAt 이슈 수정 시각 — 입력 지문에 쓴다
   */
  public record IssueBrief(
      long issueId,
      String key,
      String title,
      String body,
      String typeName,
      String epicTitle,
      String projectName,
      OffsetDateTime updatedAt) {}

  /** 지워지지 않은 이슈의 표시 정보. 지워진 이슈는 결과에서 빠진다. 부모가 에픽일 때만 에픽 제목을 싣는다. */
  public Map<Long, IssueBrief> findBriefs(Collection<Long> ids) {
    if (ids.isEmpty()) return Map.of();
    var parent = ISSUE.as("wp_parent");
    var parentType = ISSUE_TYPE_DEF.as("wp_parent_type");
    return dsl
        .select(
            ISSUE.ID,
            PROJECT.KEY,
            ISSUE.NUMBER,
            ISSUE.TITLE,
            ISSUE.BODY,
            ISSUE_TYPE_DEF.NAME,
            parent.TITLE,
            PROJECT.NAME,
            ISSUE.UPDATED_AT)
        .from(ISSUE)
        .join(PROJECT)
        .on(PROJECT.ID.eq(ISSUE.PROJECT_ID))
        .join(ISSUE_TYPE_DEF)
        .on(ISSUE_TYPE_DEF.ID.eq(ISSUE.TYPE_ID))
        .leftJoin(parent)
        .on(parent.ID.eq(ISSUE.PARENT_ISSUE_ID))
        .leftJoin(parentType)
        .on(parentType.ID.eq(parent.TYPE_ID).and(parentType.NAME.eq("EPIC")))
        .where(ISSUE.ID.in(ids), ISSUE.DELETED_AT.isNull())
        .fetch()
        .stream()
        .collect(
            Collectors.toMap(
                r -> r.value1(),
                r ->
                    new IssueBrief(
                        r.value1(),
                        r.value2() + "-" + r.value3(),
                        r.value4(),
                        r.value5(),
                        r.value6(),
                        // 부모 유형이 에픽으로 붙었을 때만 제목을 쓴다(그 외 부모는 null).
                        r.get(parentType.ID) == null ? null : r.value7(),
                        r.value8(),
                        r.value9())));
  }

  /** 이슈별 구성요소 이름(이름 오름차순). 구성요소 없는 이슈는 맵에 없다. */
  public Map<Long, List<String>> findComponentNames(Collection<Long> ids) {
    if (ids.isEmpty()) return Map.of();
    return dsl
        .select(ISSUE_COMPONENT.ISSUE_ID, PROJECT_COMPONENT.NAME)
        .from(ISSUE_COMPONENT)
        .join(PROJECT_COMPONENT)
        .on(PROJECT_COMPONENT.ID.eq(ISSUE_COMPONENT.COMPONENT_ID))
        .where(ISSUE_COMPONENT.ISSUE_ID.in(ids))
        .orderBy(PROJECT_COMPONENT.NAME.asc())
        .fetch()
        .stream()
        .collect(
            Collectors.groupingBy(
                r -> r.value1(), Collectors.mapping(r -> r.value2(), Collectors.toList())));
  }

  /** 이슈별 지워지지 않은 마지막 코멘트 본문(DISTINCT ON). 코멘트 없는 이슈는 맵에 없다. */
  public Map<Long, String> findLastComments(Collection<Long> ids) {
    if (ids.isEmpty()) return Map.of();
    Map<Long, String> out = new HashMap<>();
    dsl.select(ISSUE_COMMENT.ISSUE_ID, ISSUE_COMMENT.BODY)
        .distinctOn(ISSUE_COMMENT.ISSUE_ID)
        .from(ISSUE_COMMENT)
        .where(ISSUE_COMMENT.ISSUE_ID.in(ids), ISSUE_COMMENT.DELETED_AT.isNull())
        .orderBy(ISSUE_COMMENT.ISSUE_ID, ISSUE_COMMENT.CREATED_AT.desc(), ISSUE_COMMENT.ID.desc())
        .fetch()
        .forEach(r -> out.put(r.value1(), r.value2()));
    return out;
  }
}
