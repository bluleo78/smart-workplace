package com.workplace.issue.repository;

import static com.workplace.jooq.Tables.FILE;
import static com.workplace.jooq.Tables.ISSUE_ATTACHMENT;
import static com.workplace.jooq.Tables.USER;
import static org.jooq.impl.DSL.count;

import com.workplace.issue.dto.IssueAttachmentResponse;
import java.time.OffsetDateTime;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
import org.springframework.stereotype.Repository;

/**
 * issue_attachment N:1 jOOQ 리포지토리. file·user 와의 조인으로 응답 DTO를 직접 구성한다. file 테이블은 공유하되 이 매핑이 가리키는 row
 * 만 첨부로 취급한다.
 */
@Repository
@RequiredArgsConstructor
public class IssueAttachmentRepository {

  private final DSLContext dsl;

  /** 매핑 row 삽입. fileId 가 PK 이므로 동일 fileId 재삽입은 PK 위반(서비스 흐름상 발생 불가). */
  public void insert(Long fileId, Long issueId, Long attachedBy) {
    dsl.insertInto(ISSUE_ATTACHMENT)
        .set(ISSUE_ATTACHMENT.FILE_ID, fileId)
        .set(ISSUE_ATTACHMENT.ISSUE_ID, issueId)
        .set(ISSUE_ATTACHMENT.ATTACHED_BY, attachedBy)
        .set(ISSUE_ATTACHMENT.ATTACHED_AT, OffsetDateTime.now())
        .execute();
  }

  /** 이슈에 부착된 첨부 목록 — file/user 조인. attached_at DESC 정렬. */
  public List<IssueAttachmentResponse> findByIssue(Long issueId) {
    return dsl.select(
            ISSUE_ATTACHMENT.FILE_ID,
            ISSUE_ATTACHMENT.ISSUE_ID,
            ISSUE_ATTACHMENT.ATTACHED_BY,
            ISSUE_ATTACHMENT.ATTACHED_AT,
            FILE.ORIGINAL_NAME,
            FILE.MIME_TYPE,
            FILE.SIZE_BYTES,
            USER.NAME)
        .from(ISSUE_ATTACHMENT)
        .join(FILE)
        .on(FILE.ID.eq(ISSUE_ATTACHMENT.FILE_ID))
        .join(USER)
        .on(USER.ID.eq(ISSUE_ATTACHMENT.ATTACHED_BY))
        .where(ISSUE_ATTACHMENT.ISSUE_ID.eq(issueId))
        .orderBy(ISSUE_ATTACHMENT.ATTACHED_AT.desc())
        .fetch(
            r ->
                new IssueAttachmentResponse(
                    r.get(ISSUE_ATTACHMENT.FILE_ID),
                    r.get(ISSUE_ATTACHMENT.ISSUE_ID),
                    r.get(FILE.ORIGINAL_NAME),
                    r.get(FILE.MIME_TYPE),
                    r.get(FILE.SIZE_BYTES),
                    r.get(ISSUE_ATTACHMENT.ATTACHED_BY),
                    r.get(USER.NAME),
                    r.get(ISSUE_ATTACHMENT.ATTACHED_AT).toInstant()));
  }

  /** fileId 로 매핑 단건 조회 — 권한 검증·삭제·다운로드 전에 사용. */
  public Optional<IssueAttachmentResponse> findById(Long fileId) {
    return dsl.select(
            ISSUE_ATTACHMENT.FILE_ID,
            ISSUE_ATTACHMENT.ISSUE_ID,
            ISSUE_ATTACHMENT.ATTACHED_BY,
            ISSUE_ATTACHMENT.ATTACHED_AT,
            FILE.ORIGINAL_NAME,
            FILE.MIME_TYPE,
            FILE.SIZE_BYTES,
            USER.NAME)
        .from(ISSUE_ATTACHMENT)
        .join(FILE)
        .on(FILE.ID.eq(ISSUE_ATTACHMENT.FILE_ID))
        .join(USER)
        .on(USER.ID.eq(ISSUE_ATTACHMENT.ATTACHED_BY))
        .where(ISSUE_ATTACHMENT.FILE_ID.eq(fileId))
        .fetchOptional(
            r ->
                new IssueAttachmentResponse(
                    r.get(ISSUE_ATTACHMENT.FILE_ID),
                    r.get(ISSUE_ATTACHMENT.ISSUE_ID),
                    r.get(FILE.ORIGINAL_NAME),
                    r.get(FILE.MIME_TYPE),
                    r.get(FILE.SIZE_BYTES),
                    r.get(ISSUE_ATTACHMENT.ATTACHED_BY),
                    r.get(USER.NAME),
                    r.get(ISSUE_ATTACHMENT.ATTACHED_AT).toInstant()));
  }

  /** 이슈별 첨부 개수 (단건). */
  public int countByIssue(Long issueId) {
    return dsl.select(count())
        .from(ISSUE_ATTACHMENT)
        .where(ISSUE_ATTACHMENT.ISSUE_ID.eq(issueId))
        .fetchOne(0, Integer.class);
  }

  /** issueIds 일괄 카운트 — 검색 N+1 회피. 누락된 issueId 는 0 으로 채워준다. */
  public Map<Long, Integer> countByIssueIds(List<Long> issueIds) {
    if (issueIds == null || issueIds.isEmpty()) return Map.of();
    Map<Long, Integer> result = new HashMap<>();
    for (Long id : issueIds) result.put(id, 0);
    dsl.select(ISSUE_ATTACHMENT.ISSUE_ID, count())
        .from(ISSUE_ATTACHMENT)
        .where(ISSUE_ATTACHMENT.ISSUE_ID.in(issueIds))
        .groupBy(ISSUE_ATTACHMENT.ISSUE_ID)
        .fetch()
        .forEach(r -> result.put(r.value1(), r.value2()));
    return result;
  }

  /** 매핑 row 삭제. file row/디스크는 호출자(Service) 가 정리. */
  public void delete(Long fileId) {
    dsl.deleteFrom(ISSUE_ATTACHMENT).where(ISSUE_ATTACHMENT.FILE_ID.eq(fileId)).execute();
  }
}
