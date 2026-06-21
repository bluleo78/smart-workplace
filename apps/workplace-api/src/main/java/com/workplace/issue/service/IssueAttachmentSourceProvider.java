// IssueAttachmentSourceProvider.java — ISSUE 첨부파일 가상 뷰 제공
package com.workplace.issue.service;

import static com.workplace.jooq.Tables.FILE;
import static com.workplace.jooq.Tables.ISSUE;
import static com.workplace.jooq.Tables.ISSUE_ATTACHMENT;
import static com.workplace.jooq.Tables.PROJECT;
import static com.workplace.jooq.Tables.PROJECT_MEMBER;
import static org.jooq.impl.DSL.exists;
import static org.jooq.impl.DSL.selectOne;

import com.workplace.drive.api.AttachmentSourceProvider;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
import org.jooq.impl.DSL;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/**
 * ISSUE 첨부파일 가상 뷰 제공자. 호출자가 멤버인 프로젝트의 이슈 첨부만 노출. q=파일명 부분일치, beforeAt=커서(최신→오래된 순), limit+1 개 반환(다음
 * 페이지 판단용).
 */
@Component
@RequiredArgsConstructor
public class IssueAttachmentSourceProvider implements AttachmentSourceProvider {

  private final DSLContext dsl;

  @Override
  public String sourceType() {
    return "ISSUE";
  }

  @Override
  @Transactional(readOnly = true)
  public List<Entry> list(long callerId, String q, Instant beforeAt, int limit) {
    var query =
        dsl.select(
                FILE.ID,
                FILE.ORIGINAL_NAME,
                FILE.MIME_TYPE,
                FILE.SIZE_BYTES,
                FILE.THUMBNAIL_PATH,
                PROJECT.KEY,
                ISSUE.NUMBER,
                ISSUE.TITLE,
                ISSUE.ID.as("issue_id"),
                ISSUE_ATTACHMENT.ATTACHED_AT)
            .from(ISSUE_ATTACHMENT)
            .join(FILE)
            .on(FILE.ID.eq(ISSUE_ATTACHMENT.FILE_ID))
            .join(ISSUE)
            .on(ISSUE.ID.eq(ISSUE_ATTACHMENT.ISSUE_ID))
            .join(PROJECT)
            .on(PROJECT.ID.eq(ISSUE.PROJECT_ID))
            // 호출자가 프로젝트 멤버인 경우만 노출 (EXISTS WHERE 필터)
            .where(
                exists(
                    selectOne()
                        .from(PROJECT_MEMBER)
                        .where(
                            PROJECT_MEMBER
                                .PROJECT_ID
                                .eq(ISSUE.PROJECT_ID)
                                .and(PROJECT_MEMBER.USER_ID.eq(callerId)))))
            .and(ISSUE.DELETED_AT.isNull());

    // 파일명 부분일치 필터 (선택)
    if (q != null && !q.isBlank()) {
      query = query.and(FILE.ORIGINAL_NAME.likeIgnoreCase("%" + q + "%"));
    }

    // 커서 기반 페이지네이션 (attached_at < beforeAt)
    if (beforeAt != null) {
      OffsetDateTime cursor = beforeAt.atOffset(ZoneOffset.UTC);
      query = query.and(ISSUE_ATTACHMENT.ATTACHED_AT.lt(cursor));
    }

    return query
        .orderBy(ISSUE_ATTACHMENT.ATTACHED_AT.desc())
        .limit(limit + 1) // 다음 페이지 판단을 위해 limit+1 개 조회
        .fetch(
            r -> {
              String key = r.get(PROJECT.KEY);
              int num = r.get(ISSUE.NUMBER);
              String title = r.get(ISSUE.TITLE);
              long issueId = r.get(ISSUE.ID.as("issue_id"), Long.class);
              String sourceLabel = key + "-" + num + " " + title;
              String deepLink = "/projects/" + key + "/issues/" + num;
              // 이슈 첨부 다운로드 경로 (IssueAttachmentController 의 실제 엔드포인트)
              String downloadUrl =
                  "/api/v1/projects/"
                      + key
                      + "/issues/"
                      + num
                      + "/attachments/"
                      + r.get(FILE.ID)
                      + "/content";
              return new Entry(
                  r.get(FILE.ID),
                  r.get(FILE.ORIGINAL_NAME),
                  r.get(FILE.MIME_TYPE),
                  r.get(FILE.SIZE_BYTES),
                  r.get(FILE.THUMBNAIL_PATH) != null,
                  sourceLabel,
                  deepLink,
                  downloadUrl,
                  r.get(ISSUE_ATTACHMENT.ATTACHED_AT).toInstant());
            });
  }

  /** caller 가 멤버인 프로젝트의 이슈에 fileId 가 첨부된 경우 true. import 인가 검증용. */
  @Override
  @Transactional(readOnly = true)
  public boolean canAccessFile(long callerId, long fileId) {
    return dsl.fetchExists(
        dsl.selectOne()
            .from(ISSUE_ATTACHMENT)
            .join(ISSUE)
            .on(ISSUE.ID.eq(ISSUE_ATTACHMENT.ISSUE_ID))
            .where(ISSUE_ATTACHMENT.FILE_ID.eq(fileId))
            .and(ISSUE.DELETED_AT.isNull())
            .and(
                DSL.exists(
                    DSL.selectOne()
                        .from(PROJECT_MEMBER)
                        .where(
                            PROJECT_MEMBER
                                .PROJECT_ID
                                .eq(ISSUE.PROJECT_ID)
                                .and(PROJECT_MEMBER.USER_ID.eq(callerId))))));
  }
}
