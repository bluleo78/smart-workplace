package com.workplace.issue.repository;

import static com.workplace.jooq.Tables.ISSUE_EXTERNAL_LINK;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
import org.springframework.stereotype.Repository;

/**
 * 이슈 외부 링크(issue_external_link, WP-887) jOOQ 리포지토리. 모든 조회는 RLS 가 현재 워크스페이스로 한정한다. 같은 이슈에 같은 주소는 하나만
 * (유니크 (issue_id, url)).
 */
@Repository
@RequiredArgsConstructor
public class IssueExternalLinkRepository {

  private final DSLContext dsl;

  /** 저장된 외부 링크 한 행. */
  public record LinkRow(
      long id,
      long issueId,
      long typeId,
      boolean issueIsSource,
      String url,
      String key,
      String title) {}

  private static LinkRow toRow(org.jooq.Record r) {
    return new LinkRow(
        r.get(ISSUE_EXTERNAL_LINK.ID),
        r.get(ISSUE_EXTERNAL_LINK.ISSUE_ID),
        r.get(ISSUE_EXTERNAL_LINK.TYPE_ID),
        r.get(ISSUE_EXTERNAL_LINK.ISSUE_IS_SOURCE),
        r.get(ISSUE_EXTERNAL_LINK.URL),
        r.get(ISSUE_EXTERNAL_LINK.EXT_KEY),
        r.get(ISSUE_EXTERNAL_LINK.TITLE));
  }

  /** 이슈의 외부 링크 전부(정렬은 유형 정렬값이 필요해 서비스가 한다). */
  public List<LinkRow> findByIssue(long issueId) {
    return dsl.selectFrom(ISSUE_EXTERNAL_LINK)
        .where(ISSUE_EXTERNAL_LINK.ISSUE_ID.eq(issueId))
        .fetch(IssueExternalLinkRepository::toRow);
  }

  public Optional<LinkRow> findById(long id) {
    return dsl.selectFrom(ISSUE_EXTERNAL_LINK)
        .where(ISSUE_EXTERNAL_LINK.ID.eq(id))
        .fetchOptional(IssueExternalLinkRepository::toRow);
  }

  /** 같은 이슈의 같은 주소 한 행. */
  public Optional<LinkRow> findByIssueAndUrl(long issueId, String url) {
    return dsl.selectFrom(ISSUE_EXTERNAL_LINK)
        .where(ISSUE_EXTERNAL_LINK.ISSUE_ID.eq(issueId).and(ISSUE_EXTERNAL_LINK.URL.eq(url)))
        .fetchOptional(IssueExternalLinkRepository::toRow);
  }

  public int countByIssue(long issueId) {
    return dsl.fetchCount(ISSUE_EXTERNAL_LINK, ISSUE_EXTERNAL_LINK.ISSUE_ID.eq(issueId));
  }

  /**
   * 외부 링크 한 줄을 넣는다 — 같은 (이슈, 주소) 가 이미 있으면 그대로 둔다(ON CONFLICT DO NOTHING).
   *
   * @return 새로 넣었으면 true, 이미 있어 건너뛰었으면 false(동시 요청에도 이력은 한 번만 남게 이 값으로 가른다)
   */
  public boolean insertIfAbsent(
      long issueId,
      long typeId,
      boolean issueIsSource,
      String url,
      String key,
      String title,
      Long createdBy) {
    return dsl.insertInto(ISSUE_EXTERNAL_LINK)
            .set(ISSUE_EXTERNAL_LINK.ISSUE_ID, issueId)
            .set(ISSUE_EXTERNAL_LINK.TYPE_ID, typeId)
            .set(ISSUE_EXTERNAL_LINK.ISSUE_IS_SOURCE, issueIsSource)
            .set(ISSUE_EXTERNAL_LINK.URL, url)
            .set(ISSUE_EXTERNAL_LINK.EXT_KEY, key)
            .set(ISSUE_EXTERNAL_LINK.TITLE, title)
            .set(ISSUE_EXTERNAL_LINK.CREATED_BY, createdBy)
            .onConflictDoNothing()
            .execute()
        > 0;
  }

  /** 유형·방향·키·제목을 고친다(주소는 바꾸지 않는다). */
  public void update(long id, long typeId, boolean issueIsSource, String key, String title) {
    dsl.update(ISSUE_EXTERNAL_LINK)
        .set(ISSUE_EXTERNAL_LINK.TYPE_ID, typeId)
        .set(ISSUE_EXTERNAL_LINK.ISSUE_IS_SOURCE, issueIsSource)
        .set(ISSUE_EXTERNAL_LINK.EXT_KEY, key)
        .set(ISSUE_EXTERNAL_LINK.TITLE, title)
        .set(ISSUE_EXTERNAL_LINK.UPDATED_AT, OffsetDateTime.now())
        .where(ISSUE_EXTERNAL_LINK.ID.eq(id))
        .execute();
  }

  /** 지운 행 수(0 이면 이미 없음 → 이력·신호를 내지 않는다). */
  public int deleteById(long id) {
    return dsl.deleteFrom(ISSUE_EXTERNAL_LINK).where(ISSUE_EXTERNAL_LINK.ID.eq(id)).execute();
  }
}
