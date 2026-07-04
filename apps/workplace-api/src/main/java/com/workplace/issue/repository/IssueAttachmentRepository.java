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

  /**
   * 이슈 첨부 잠금 전용 classId — 2-인자 pg_advisory_xact_lock(classId, issueId) 형태에서 사용.
   *
   * <p>Postgres 에서 2-인자(int, int) advisory lock 은 1-인자(bigint) lock 과 별개 네임스페이스를 사용하므로,
   * UserRepository.acquireFirstUserLock() 등 다른 도메인의 1-인자 잠금과 충돌하지 않는다. DriveQuotaRepository 와 같은
   * 패턴(이슈 번호 #625 를 classId 로 사용)으로 이슈 첨부 잠금임을 명시한다.
   */
  private static final int ISSUE_ATTACHMENT_LOCK_CLASS = 625;

  /**
   * 이슈 단위 직렬화 잠금 — 동시 업로드 시 "개수 조회 → 비교 → INSERT" TOCTOU 레이스 방지(트랜잭션 종료 시 자동 해제, #625).
   *
   * <p>업로드 트랜잭션 초입에서 이슈 id 로 잠금을 획득하면, 같은 이슈에 대한 동시 업로드 요청은 하나씩 직렬화되어 이후의 countByIssue 조회가 최신 값을 보게
   * 된다.
   */
  public void advisoryLockIssue(long issueId) {
    // 2-인자 형태로 issue-attachment 전용 네임스페이스(ISSUE_ATTACHMENT_LOCK_CLASS=625)를 분리해
    // 타 도메인 1-인자 잠금과의 전역 충돌을 방지한다.
    dsl.execute("SELECT pg_advisory_xact_lock(?, ?)", ISSUE_ATTACHMENT_LOCK_CLASS, (int) issueId);
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
