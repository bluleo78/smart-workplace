// IssueAttachmentSourceProvider.java — ISSUE 첨부파일 가상 뷰 제공
package com.workplace.issue.service;

import static com.workplace.jooq.Tables.FILE;
import static com.workplace.jooq.Tables.ISSUE;
import static com.workplace.jooq.Tables.ISSUE_ATTACHMENT;
import static com.workplace.jooq.Tables.ISSUE_BODY_IMAGE;
import static com.workplace.jooq.Tables.PROJECT;

import com.workplace.drive.api.AttachmentSourceProvider;
import com.workplace.global.share.ProjectMembership;
import com.workplace.global.util.LikePatternUtils;
import com.workplace.issue.dto.IssueBodyImageResponse;
import java.time.OffsetDateTime;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.jooq.Condition;
import org.jooq.DSLContext;
import org.jooq.Field;
import org.jooq.Record;
import org.jooq.impl.DSL;
import org.jooq.impl.SQLDataType;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/**
 * ISSUE 첨부파일 가상 뷰 제공자. 호출자가 멤버인 프로젝트의 이슈 첨부와 이슈 본문 이미지(WP-1392)를 노출. q=파일명 부분일치, cursor=커서(최신→오래된
 * 순), limit+1 개 반환(다음 페이지 판단용).
 *
 * <p>본문 이미지는 「이슈」 출처에 합친다 — 사용자에게는 둘 다 그 이슈의 파일이라 칩을 따로 두지 않고, 행에만 {@code kind="BODY_IMAGE"} 로
 * 표시한다(웹이 「· 본문」).
 */
@Component
@RequiredArgsConstructor
public class IssueAttachmentSourceProvider implements AttachmentSourceProvider {

  private final DSLContext dsl;

  @Override
  public String sourceType() {
    return "ISSUE";
  }

  /** 이슈 본문 이미지 표시 — Entry.kind 값. */
  static final String KIND_BODY_IMAGE = "BODY_IMAGE";

  /** 합친 결과의 시각 열 — 이슈 첨부는 attached_at, 본문 이미지는 업로드(created_at)를 이 이름으로 맞춘다. */
  private static final Field<OffsetDateTime> AT =
      DSL.field(DSL.name("attached_at"), ISSUE_ATTACHMENT.ATTACHED_AT.getDataType());

  /** 합친 결과의 file id 열(정렬 보조 키) — 두 표 모두 file_id 가 PK 라 출처 안에서 유일하다. */
  private static final Field<Long> FILE_ID = DSL.field(DSL.name("file_id"), FILE.ID.getDataType());

  /** 합친 결과의 세부 종류 열 — 이슈 첨부는 NULL, 본문 이미지는 {@link #KIND_BODY_IMAGE}. */
  private static final Field<String> KIND = DSL.field(DSL.name("kind"), SQLDataType.VARCHAR);

  /**
   * 이슈 첨부와 본문 이미지를 UNION ALL 한 쿼리로 읽어 (시각, file id) 내림차순 limit+1 개. 각 갈래는 자기 시각·file id 열로 커서를 거르고,
   * 합친 뒤 같은 두 열로 한 번 정렬한다 — 커서 조건과 정렬이 같은 식을 쓴다({@link Cursor#order}).
   */
  @Override
  @Transactional(readOnly = true)
  public List<Entry> list(long callerId, String q, Cursor cursor, int limit) {
    // 이슈 첨부(issue_attachment) 갈래 — 호출자가 프로젝트 멤버 + 이슈 미삭제
    var attachments =
        dsl.select(
                FILE.ID.as(FILE_ID),
                FILE.ORIGINAL_NAME,
                FILE.MIME_TYPE,
                FILE.SIZE_BYTES,
                FILE.THUMBNAIL_PATH,
                PROJECT.KEY,
                ISSUE.NUMBER,
                ISSUE.TITLE,
                ISSUE_ATTACHMENT.ATTACHED_AT.as(AT),
                DSL.castNull(SQLDataType.VARCHAR).as(KIND))
            .from(ISSUE_ATTACHMENT)
            .join(FILE)
            .on(FILE.ID.eq(ISSUE_ATTACHMENT.FILE_ID))
            .join(ISSUE)
            .on(ISSUE.ID.eq(ISSUE_ATTACHMENT.ISSUE_ID))
            .join(PROJECT)
            .on(PROJECT.ID.eq(ISSUE.PROJECT_ID))
            // 호출자가 프로젝트 멤버인 경우만 노출 (EXISTS WHERE 필터)
            .where(issueVisible(callerId))
            .and(nameMatches(q))
            // 커서 — (attached_at, file_id) 가 커서 다음인 행(같은 시각도 빠지지 않게)
            .and(
                Cursor.after(
                    cursor, sourceType(), ISSUE_ATTACHMENT.ATTACHED_AT, ISSUE_ATTACHMENT.FILE_ID));

    // 이슈 본문 이미지(issue_body_image) 갈래 — 연결됨·강등 아님(bodyImageVisible). 시각은 업로드(created_at)
    var bodyImages =
        dsl.select(
                FILE.ID.as(FILE_ID),
                FILE.ORIGINAL_NAME,
                FILE.MIME_TYPE,
                FILE.SIZE_BYTES,
                FILE.THUMBNAIL_PATH,
                PROJECT.KEY,
                ISSUE.NUMBER,
                ISSUE.TITLE,
                ISSUE_BODY_IMAGE.CREATED_AT.as(AT),
                DSL.inline(KIND_BODY_IMAGE).as(KIND))
            .from(ISSUE_BODY_IMAGE)
            .join(FILE)
            .on(FILE.ID.eq(ISSUE_BODY_IMAGE.FILE_ID))
            .join(ISSUE)
            .on(ISSUE.ID.eq(ISSUE_BODY_IMAGE.ISSUE_ID))
            .join(PROJECT)
            .on(PROJECT.ID.eq(ISSUE.PROJECT_ID))
            .where(bodyImageVisible(callerId))
            .and(nameMatches(q))
            .and(
                Cursor.after(
                    cursor, sourceType(), ISSUE_BODY_IMAGE.CREATED_AT, ISSUE_BODY_IMAGE.FILE_ID));

    return attachments
        .unionAll(bodyImages)
        .orderBy(Cursor.order(AT, FILE_ID))
        .limit(limit + 1) // 다음 페이지 판단을 위해 limit+1 개 조회
        .fetch(IssueAttachmentSourceProvider::toEntry);
  }

  /** 합친 한 행 → Entry. 내려받기 경로는 갈래(kind)에 따라 이슈 첨부 엔드포인트 또는 본문 이미지 서빙 경로. */
  private static Entry toEntry(Record r) {
    String key = r.get(PROJECT.KEY);
    int num = r.get(ISSUE.NUMBER);
    long fileId = r.get(FILE_ID);
    String kind = r.get(KIND);
    String downloadUrl =
        KIND_BODY_IMAGE.equals(kind)
            // 본문 이미지 서빙 경로 (IssueBodyImageController GET /{fileId}) — 본문 참조 URL 과 같다
            ? IssueBodyImageResponse.urlOf(key, fileId)
            // 이슈 첨부 다운로드 경로 (IssueAttachmentController 의 실제 엔드포인트)
            : "/api/v1/projects/" + key + "/issues/" + num + "/attachments/" + fileId + "/content";
    return new Entry(
        fileId,
        r.get(FILE.ORIGINAL_NAME),
        r.get(FILE.MIME_TYPE),
        r.get(FILE.SIZE_BYTES),
        r.get(FILE.THUMBNAIL_PATH) != null,
        key + "-" + num + " " + r.get(ISSUE.TITLE),
        "/projects/" + key + "/issues/" + num,
        downloadUrl,
        r.get(AT).toInstant(),
        kind,
        null);
  }

  /** 파일명 부분일치 필터 — q 가 비면 조건 없음. */
  private static Condition nameMatches(String q) {
    return q == null || q.isBlank()
        ? DSL.noCondition()
        : FILE.ORIGINAL_NAME.likeIgnoreCase(LikePatternUtils.containsPattern(q), '\\');
  }

  /** 모아보기에 보일 이슈 조건 — 이슈 미삭제·호출자가 프로젝트 멤버. 첨부·본문 이미지, 목록·가져오기 인가가 모두 이 규칙을 쓴다. */
  private static Condition issueVisible(long callerId) {
    return ISSUE.DELETED_AT.isNull().and(ProjectMembership.isMemberOf(ISSUE.PROJECT_ID, callerId));
  }

  /** 모아보기에 보일 본문 이미지 조건 — 연결됨·강등 아님·이슈 미삭제·호출자가 프로젝트 멤버. 목록과 가져오기 인가가 같은 규칙을 쓴다. */
  private static Condition bodyImageVisible(long callerId) {
    return ISSUE_BODY_IMAGE
        .ISSUE_ID
        .isNotNull()
        .and(ISSUE_BODY_IMAGE.DEMOTED_AT.isNull())
        .and(issueVisible(callerId));
  }

  /**
   * caller 가 멤버인 프로젝트의 이슈에 fileId 가 첨부됐거나, 그 이슈의 본문 이미지(연결됨·강등 아님)인 경우 true. import 인가 검증용 — 목록에
   * 보이는 것만 가져올 수 있게 같은 조건을 쓴다.
   */
  @Override
  @Transactional(readOnly = true)
  public boolean canAccessFile(long callerId, long fileId) {
    return dsl.fetchExists(
        dsl.selectOne()
            .from(ISSUE_ATTACHMENT)
            .join(ISSUE)
            .on(ISSUE.ID.eq(ISSUE_ATTACHMENT.ISSUE_ID))
            .where(ISSUE_ATTACHMENT.FILE_ID.eq(fileId))
            .and(issueVisible(callerId))
            .unionAll(
                dsl.selectOne()
                    .from(ISSUE_BODY_IMAGE)
                    .join(ISSUE)
                    .on(ISSUE.ID.eq(ISSUE_BODY_IMAGE.ISSUE_ID))
                    .where(ISSUE_BODY_IMAGE.FILE_ID.eq(fileId))
                    .and(bodyImageVisible(callerId))));
  }
}
