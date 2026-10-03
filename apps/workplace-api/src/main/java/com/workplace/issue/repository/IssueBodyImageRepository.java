package com.workplace.issue.repository;

import static com.workplace.jooq.Tables.FILE;
import static com.workplace.jooq.Tables.ISSUE;
import static com.workplace.jooq.Tables.ISSUE_BODY_IMAGE;

import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.Collection;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import org.jooq.DSLContext;
import org.jooq.impl.DSL;
import org.springframework.stereotype.Repository;

/**
 * 이슈 본문 이미지 매핑(issue_body_image) 저장소 — WP-199.
 *
 * <p>수명은 file.expires_at 으로 관리한다: 업로드 직후 임시(만료 있음) → 저장 시 연결(만료 해제) → 본문에서 빠지면 강등(유예 후 만료 재무장). 실제
 * 삭제는 FileCleanupService 스윕이 하고 매핑은 CASCADE 로 사라진다. 위키(WikiAttachmentRepository, #759)와 같은 모델이다.
 */
@Repository
public class IssueBodyImageRepository {

  private final DSLContext dsl;

  public IssueBodyImageRepository(DSLContext dsl) {
    this.dsl = dsl;
  }

  /** 조회 인가에 필요한 매핑 정보. issueId 가 null 이면 아직 어느 이슈에도 연결되지 않은 임시 업로드. */
  public record Meta(long fileId, long projectId, Long issueId, long uploadedBy) {}

  /** 업로드 직후 임시 매핑 INSERT(tenant_id 는 DEFAULT). */
  public void insertPending(long fileId, long projectId, long uploadedBy) {
    dsl.insertInto(ISSUE_BODY_IMAGE)
        .set(ISSUE_BODY_IMAGE.FILE_ID, fileId)
        .set(ISSUE_BODY_IMAGE.PROJECT_ID, projectId)
        .set(ISSUE_BODY_IMAGE.UPLOADED_BY, uploadedBy)
        .execute();
  }

  /** 사용자가 이 프로젝트에 올려 두고 아직 어떤 이슈에도 연결하지 않은 이미지 수 — 업로드 남용 상한용. */
  public int countPending(long projectId, long uploadedBy) {
    return dsl.fetchCount(
        ISSUE_BODY_IMAGE,
        ISSUE_BODY_IMAGE
            .PROJECT_ID
            .eq(projectId)
            .and(ISSUE_BODY_IMAGE.UPLOADED_BY.eq(uploadedBy))
            .and(ISSUE_BODY_IMAGE.ISSUE_ID.isNull()));
  }

  public Optional<Meta> findMeta(long fileId) {
    return dsl.select(
            ISSUE_BODY_IMAGE.FILE_ID,
            ISSUE_BODY_IMAGE.PROJECT_ID,
            ISSUE_BODY_IMAGE.ISSUE_ID,
            ISSUE_BODY_IMAGE.UPLOADED_BY)
        .from(ISSUE_BODY_IMAGE)
        .where(ISSUE_BODY_IMAGE.FILE_ID.eq(fileId))
        .fetchOptional(r -> new Meta(r.value1(), r.value2(), r.value3(), r.value4()));
  }

  /**
   * 본문에 적힌 fileId 중 이 이슈에 연결해도 되는 것만 골라 file 행을 잠근다.
   *
   * <p>대상: 같은 프로젝트이면서 (내가 올린 미연결 임시 파일) 또는 (이미 이 이슈에 연결된 파일). 남의 임시 파일·다른 프로젝트·다른 도메인(채팅·드라이브) 파일은
   * 매핑이 없거나 조건이 맞지 않아 빠진다. FOR UPDATE: 정리 스윕은 SKIP LOCKED 라 잠근 행을 건너뛰고, 스윕이 먼저 잡았으면 여기서 기다렸다가 행이
   * 사라진 상태로 재평가돼 결과에서 빠진다 — 그래서 이후 claim 은 살아 있는 행만 대상으로 한다.
   */
  public List<Long> lockClaimable(
      long projectId, long issueId, long callerId, Collection<Long> fileIds) {
    if (fileIds.isEmpty()) return List.of();
    return dsl.select(FILE.ID)
        .from(FILE)
        .join(ISSUE_BODY_IMAGE)
        .on(ISSUE_BODY_IMAGE.FILE_ID.eq(FILE.ID))
        .where(FILE.ID.in(fileIds))
        .and(ISSUE_BODY_IMAGE.PROJECT_ID.eq(projectId))
        .and(
            ISSUE_BODY_IMAGE
                .ISSUE_ID
                .isNull()
                .and(ISSUE_BODY_IMAGE.UPLOADED_BY.eq(callerId))
                .or(ISSUE_BODY_IMAGE.ISSUE_ID.eq(issueId)))
        .forUpdate()
        .of(FILE)
        .fetch(FILE.ID);
  }

  /** 잠근 파일을 이 이슈에 연결하고 만료를 해제한다(강등 중이던 것도 원상 복구). */
  public void claim(long issueId, Collection<Long> fileIds) {
    if (fileIds.isEmpty()) return;
    dsl.update(ISSUE_BODY_IMAGE)
        .set(ISSUE_BODY_IMAGE.ISSUE_ID, issueId)
        .setNull(ISSUE_BODY_IMAGE.DEMOTED_AT)
        .where(ISSUE_BODY_IMAGE.FILE_ID.in(fileIds))
        .execute();
    dsl.update(FILE).setNull(FILE.EXPIRES_AT).where(FILE.ID.in(fileIds)).execute();
  }

  public List<Long> fileIdsOfIssue(long issueId) {
    return dsl.select(ISSUE_BODY_IMAGE.FILE_ID)
        .from(ISSUE_BODY_IMAGE)
        .where(ISSUE_BODY_IMAGE.ISSUE_ID.eq(issueId))
        .fetch(ISSUE_BODY_IMAGE.FILE_ID);
  }

  /**
   * 본문에서 빠진 연결 이미지를 강등 — 삭제가 아니라 만료 재무장. 이미 만료가 걸린 것(강등 중)은 건드리지 않아 유예가 계속 늘어나지 않게 한다.
   *
   * @return 실제로 강등된 fileId
   */
  public List<Long> demote(Collection<Long> fileIds, OffsetDateTime expiresAt) {
    if (fileIds.isEmpty()) return List.of();
    List<Long> demoted =
        dsl.update(FILE)
            .set(FILE.EXPIRES_AT, expiresAt)
            .where(FILE.ID.in(fileIds))
            .and(FILE.EXPIRES_AT.isNull())
            .returningResult(FILE.ID)
            .fetch()
            .map(r -> r.get(0, Long.class));
    if (demoted.isEmpty()) return List.of();
    dsl.update(ISSUE_BODY_IMAGE)
        .set(ISSUE_BODY_IMAGE.DEMOTED_AT, OffsetDateTime.now(ZoneOffset.UTC))
        .where(ISSUE_BODY_IMAGE.FILE_ID.in(demoted))
        .execute();
    return demoted;
  }

  /**
   * 주어진 fileId 중 이슈에 연결된(issue_id NOT NULL) 이슈 이미지이면서, 같은 프로젝트의 삭제되지 않은 이슈 본문 어디서든 아직 참조되는 것.
   *
   * <p>본문을 복사해 다른 이슈에 붙여넣은 이미지는 원본 이슈 매핑으로 서빙되므로, 원본에서 빠졌다고 지우면 사본이 깨진다. 스윕 시점에만 호출되므로 본문 정규식 스캔
   * 비용을 감당할 수 있다. 정규식 끝의 ([^0-9]|$) 는 /issue-images/12 가 123 에 매칭되는 것을 막는다.
   */
  public Set<Long> stillReferencedAnywhere(Collection<Long> fileIds) {
    if (fileIds.isEmpty()) return Set.of();
    var candidates =
        dsl.select(ISSUE_BODY_IMAGE.FILE_ID, ISSUE_BODY_IMAGE.PROJECT_ID)
            .from(ISSUE_BODY_IMAGE)
            .where(ISSUE_BODY_IMAGE.FILE_ID.in(fileIds))
            // 이슈에 연결된(claim 된) 이미지만 후보 — 미연결 임시 업로드는 남이 URL 을 붙여넣어도 24h 뒤 만료돼야 한다.
            .and(ISSUE_BODY_IMAGE.ISSUE_ID.isNotNull())
            .fetch();
    Set<Long> alive = new LinkedHashSet<>();
    for (var c : candidates) {
      long fileId = c.value1();
      boolean referenced =
          dsl.fetchExists(
              dsl.selectOne()
                  .from(ISSUE)
                  .where(ISSUE.PROJECT_ID.eq(c.value2()))
                  .and(ISSUE.DELETED_AT.isNull())
                  .and(
                      DSL.condition(
                          "{0} ~ {1}",
                          ISSUE.BODY, DSL.val("/issue-images/" + fileId + "([^0-9]|$)"))));
      if (referenced) alive.add(fileId);
    }
    return alive;
  }

  /** 보존 판정된 파일의 만료를 유예만큼 다시 미룬다 — 해제(NULL)하면 재무장 트리거가 없어 영구 고아가 된다(위키 #759 와 같은 이유). */
  public void rearm(Collection<Long> fileIds, OffsetDateTime expiresAt) {
    if (fileIds.isEmpty()) return;
    dsl.update(FILE).set(FILE.EXPIRES_AT, expiresAt).where(FILE.ID.in(fileIds)).execute();
  }
}
