package com.workplace.mail.repository;

import static com.workplace.jooq.Tables.EMAIL_ACCOUNT;
import static com.workplace.jooq.Tables.EMAIL_ATTACHMENT;
import static com.workplace.jooq.Tables.EMAIL_FOLDER;
import static com.workplace.jooq.Tables.EMAIL_MESSAGE;

import com.workplace.mail.dto.ParsedAttachment;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
import org.jooq.impl.DSL;
import org.springframework.stereotype.Repository;

/** email_attachment jOOQ 리포지토리. 첨부 메타만 저장하고 바이너리는 보관하지 않는다(다운로드는 후속). */
@Repository
@RequiredArgsConstructor
public class EmailAttachmentRepository {

  private final DSLContext dsl;

  /**
   * 다운로드에 필요한 첨부 컨텍스트. 소유 검증(account.user_id + disabled_at)을 포함하며, 첨부의 메시지 내 순서(ordinal)를 서브쿼리로 계산해
   * 반환한다.
   */
  public record AttachmentDownloadContext(
      long attachmentId,
      String filename,
      String contentType,
      int ordinal, // 메시지 내 0-based 삽입 순서 (id 오름차순 = MIME 순회 순서)
      long accountId,
      long imapUid,
      String folderName) {}

  /** 첨부 ID + 소유자 userId 로 다운로드 컨텍스트 조회. 없거나 타인 소유면 empty. */
  public Optional<AttachmentDownloadContext> findContextForDownload(
      long userId, long attachmentId) {
    // 순서(ordinal) = 동일 message_id 에서 id < 현재 id 인 첨부 건수 (0-based)
    var ordinalSubquery =
        DSL.selectCount()
            .from(EMAIL_ATTACHMENT.as("ea2"))
            .where(
                EMAIL_ATTACHMENT.as("ea2").MESSAGE_ID.eq(EMAIL_ATTACHMENT.MESSAGE_ID),
                EMAIL_ATTACHMENT.as("ea2").ID.lt(EMAIL_ATTACHMENT.ID));

    return dsl.select(
            EMAIL_ATTACHMENT.ID,
            EMAIL_ATTACHMENT.FILENAME,
            EMAIL_ATTACHMENT.CONTENT_TYPE,
            ordinalSubquery.asField("ordinal"),
            EMAIL_MESSAGE.ACCOUNT_ID,
            EMAIL_MESSAGE.IMAP_UID,
            EMAIL_FOLDER.NAME)
        .from(EMAIL_ATTACHMENT)
        .join(EMAIL_MESSAGE)
        .on(EMAIL_MESSAGE.ID.eq(EMAIL_ATTACHMENT.MESSAGE_ID))
        .join(EMAIL_FOLDER)
        .on(EMAIL_FOLDER.ID.eq(EMAIL_MESSAGE.FOLDER_ID))
        .join(EMAIL_ACCOUNT)
        .on(EMAIL_ACCOUNT.ID.eq(EMAIL_MESSAGE.ACCOUNT_ID))
        .where(EMAIL_ATTACHMENT.ID.eq(attachmentId))
        .and(EMAIL_ACCOUNT.USER_ID.eq(userId))
        .and(EMAIL_ACCOUNT.DISABLED_AT.isNull())
        .fetchOptional(
            r ->
                new AttachmentDownloadContext(
                    r.get(EMAIL_ATTACHMENT.ID),
                    r.get(EMAIL_ATTACHMENT.FILENAME),
                    r.get(EMAIL_ATTACHMENT.CONTENT_TYPE),
                    r.get("ordinal", Integer.class),
                    r.get(EMAIL_MESSAGE.ACCOUNT_ID),
                    r.get(EMAIL_MESSAGE.IMAP_UID) == null ? 0L : r.get(EMAIL_MESSAGE.IMAP_UID),
                    r.get(EMAIL_FOLDER.NAME)));
  }

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
