package com.workplace.mail.repository;

import static com.workplace.jooq.Tables.EMAIL_ATTACHMENT;

import com.workplace.mail.dto.ParsedAttachment;
import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
import org.springframework.stereotype.Repository;

/** email_attachment jOOQ 리포지토리. 첨부 메타만 저장하고 바이너리는 보관하지 않는다(다운로드는 후속). */
@Repository
@RequiredArgsConstructor
public class EmailAttachmentRepository {

  private final DSLContext dsl;

  /** 메시지에 첨부 메타 1건 저장. */
  public void insert(long messageId, ParsedAttachment a) {
    dsl.insertInto(EMAIL_ATTACHMENT)
        .set(EMAIL_ATTACHMENT.MESSAGE_ID, messageId)
        .set(EMAIL_ATTACHMENT.FILENAME, a.filename())
        .set(EMAIL_ATTACHMENT.CONTENT_TYPE, a.contentType())
        .set(EMAIL_ATTACHMENT.SIZE_BYTES, a.sizeBytes())
        .set(EMAIL_ATTACHMENT.CONTENT_ID, a.contentId())
        .execute();
  }
}
