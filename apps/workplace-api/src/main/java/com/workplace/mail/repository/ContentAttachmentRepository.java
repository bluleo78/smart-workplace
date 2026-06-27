package com.workplace.mail.repository;

import static com.workplace.jooq.Tables.CONTENT_ATTACHMENT;

import lombok.RequiredArgsConstructor;
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
}
