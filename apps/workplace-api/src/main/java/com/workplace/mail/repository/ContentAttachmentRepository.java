package com.workplace.mail.repository;

import static com.workplace.jooq.Tables.CONTENT_ATTACHMENT;

import lombok.RequiredArgsConstructor;
import org.jooq.Condition;
import org.jooq.DSLContext;
import org.springframework.stereotype.Repository;

/** content_attachment(per-content 공유 첨부 manifest) 리포지토리. */
@Repository
@RequiredArgsConstructor
public class ContentAttachmentRepository {

  private final DSLContext dsl;

  /**
   * (content_id, ordinal) 기준 find-or-create. 같은 메일을 받은 다른 envelope 의 sync 가 같은 위치 첨부에 대해 같은
   * manifest 행을 공유하도록 보장한다. ON CONFLICT DO NOTHING 후 id 를 다시 조회한다(동시 sync 경쟁 흡수).
   *
   * @return content_attachment id
   */
  public long findOrCreate(
      long contentId,
      int ordinal,
      String filename,
      String contentType,
      Long sizeBytes,
      String mimeContentId) {
    dsl.insertInto(CONTENT_ATTACHMENT)
        .set(CONTENT_ATTACHMENT.CONTENT_ID, contentId)
        .set(CONTENT_ATTACHMENT.ORDINAL, ordinal)
        .set(CONTENT_ATTACHMENT.FILENAME, filename)
        .set(CONTENT_ATTACHMENT.CONTENT_TYPE, contentType)
        .set(CONTENT_ATTACHMENT.SIZE_BYTES, sizeBytes)
        .set(CONTENT_ATTACHMENT.MIME_CONTENT_ID, mimeContentId)
        .onConflict(CONTENT_ATTACHMENT.CONTENT_ID, CONTENT_ATTACHMENT.ORDINAL)
        .doNothing()
        .execute();
    return dsl.select(CONTENT_ATTACHMENT.ID)
        .from(CONTENT_ATTACHMENT)
        .where(CONTENT_ATTACHMENT.CONTENT_ID.eq(contentId))
        .and(CONTENT_ATTACHMENT.ORDINAL.eq(ordinal))
        .fetchOne(CONTENT_ATTACHMENT.ID);
  }

  /** content_hash 가 NULL 일 때만 기록(첫 다운로드 시 1회 — 불변 식별자). */
  public void setContentHashIfNull(long contentAttachmentId, String hash) {
    dsl.update(CONTENT_ATTACHMENT)
        .set(CONTENT_ATTACHMENT.CONTENT_HASH, hash)
        .where(CONTENT_ATTACHMENT.ID.eq(contentAttachmentId))
        .and(CONTENT_ATTACHMENT.CONTENT_HASH.isNull())
        .execute();
  }

  /**
   * mime_content_id 가 비어 있을 때만 기록(WP-68). 공유 manifest 행은 find-or-create 로 재사용되므로, 규칙 도입 전 적재된 행이나
   * 지연 백필로 알아낸 Content-ID 를 기존 실제 값 덮어쓰기 없이 채운다.
   *
   * <p>빈 문자열은 지연 백필의 "확인했지만 없음" 표시다. 실제 값은 NULL 뿐 아니라 이 표시도 덮어쓴다(다른 경로가 나중에 진짜 Content-ID 를 알게 된
   * 경우). 표시값 자체는 NULL 에만 기록한다.
   */
  public void setMimeContentIdIfNull(long contentAttachmentId, String mimeContentId) {
    Condition empty =
        mimeContentId.isEmpty()
            ? CONTENT_ATTACHMENT.MIME_CONTENT_ID.isNull()
            : CONTENT_ATTACHMENT
                .MIME_CONTENT_ID
                .isNull()
                .or(CONTENT_ATTACHMENT.MIME_CONTENT_ID.eq(""));
    dsl.update(CONTENT_ATTACHMENT)
        .set(CONTENT_ATTACHMENT.MIME_CONTENT_ID, mimeContentId)
        .where(CONTENT_ATTACHMENT.ID.eq(contentAttachmentId))
        .and(empty)
        .execute();
  }
}
