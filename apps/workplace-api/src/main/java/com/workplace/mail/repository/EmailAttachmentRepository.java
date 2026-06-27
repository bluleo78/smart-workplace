package com.workplace.mail.repository;

import static com.workplace.jooq.Tables.CONTENT_ATTACHMENT;
import static com.workplace.jooq.Tables.EMAIL_ACCOUNT;
import static com.workplace.jooq.Tables.EMAIL_ATTACHMENT;
import static com.workplace.jooq.Tables.EMAIL_FOLDER;
import static com.workplace.jooq.Tables.EMAIL_MESSAGE;

import com.workplace.mail.dto.ParsedAttachment;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
import org.springframework.stereotype.Repository;

/** email_attachment jOOQ 리포지토리. 첨부 메타만 저장하고 바이너리는 보관하지 않는다(다운로드는 후속). */
@Repository
@RequiredArgsConstructor
public class EmailAttachmentRepository {

  private final DSLContext dsl;

  /** content_attachment(공유 manifest) 리포지토리 — insert 시 find-or-create 위임. */
  private final ContentAttachmentRepository contentAttachmentRepo;

  /**
   * 다운로드에 필요한 첨부 컨텍스트. 소유 검증(account.user_id + disabled_at)을 포함한다. filename/contentType/ordinal 은
   * content_attachment 조인에서 읽고, content_attachment_id·content_hash 도 반환한다. provider 로 IMAP/Graph
   * 다운로드 경로를 분기한다.
   *
   * <p>providerAttachmentId: Graph 첨부의 안정 id — V91 이전 동기화 행은 null. IMAP 행도 null.
   */
  public record AttachmentDownloadContext(
      long attachmentId,
      long contentAttachmentId, // 신규 — content_attachment manifest 링크
      String contentHash, // 신규 — content_attachment.content_hash (nullable, 미계산=null)
      String filename, // content_attachment 출처
      String contentType, // content_attachment 출처
      int ordinal, // email_attachment.ordinal (안정 좌표)
      long accountId,
      long imapUid,
      String folderName,
      String provider, // 'IMAP' or 'M365_GRAPH' — 다운로드 경로 분기
      String providerMessageId, // Graph 메시지 id (IMAP 계정은 null)
      String providerAttachmentId) // Graph 첨부 안정 id (V91+, 미저장 행은 null)
  {}

  /** 첨부 ID + 소유자 userId 로 다운로드 컨텍스트 조회. 없거나 타인 소유면 empty. */
  public Optional<AttachmentDownloadContext> findContextForDownload(
      long userId, long attachmentId) {
    return dsl.select(
            EMAIL_ATTACHMENT.ID,
            EMAIL_ATTACHMENT.CONTENT_ATTACHMENT_ID,
            CONTENT_ATTACHMENT.CONTENT_HASH,
            CONTENT_ATTACHMENT.FILENAME,
            CONTENT_ATTACHMENT.CONTENT_TYPE,
            EMAIL_ATTACHMENT.ORDINAL,
            EMAIL_MESSAGE.ACCOUNT_ID,
            EMAIL_MESSAGE.IMAP_UID,
            EMAIL_FOLDER.NAME,
            EMAIL_ACCOUNT.PROVIDER,
            EMAIL_MESSAGE.PROVIDER_MESSAGE_ID,
            EMAIL_ATTACHMENT.PROVIDER_ATTACHMENT_ID)
        .from(EMAIL_ATTACHMENT)
        .leftJoin(CONTENT_ATTACHMENT)
        .on(CONTENT_ATTACHMENT.ID.eq(EMAIL_ATTACHMENT.CONTENT_ATTACHMENT_ID))
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
            r -> {
              Long caId = r.get(EMAIL_ATTACHMENT.CONTENT_ATTACHMENT_ID);
              return new AttachmentDownloadContext(
                  r.get(EMAIL_ATTACHMENT.ID),
                  caId == null ? 0L : caId,
                  r.get(CONTENT_ATTACHMENT.CONTENT_HASH),
                  r.get(CONTENT_ATTACHMENT.FILENAME),
                  r.get(CONTENT_ATTACHMENT.CONTENT_TYPE),
                  r.get(EMAIL_ATTACHMENT.ORDINAL) == null ? 0 : r.get(EMAIL_ATTACHMENT.ORDINAL),
                  r.get(EMAIL_MESSAGE.ACCOUNT_ID),
                  r.get(EMAIL_MESSAGE.IMAP_UID) == null ? 0L : r.get(EMAIL_MESSAGE.IMAP_UID),
                  r.get(EMAIL_FOLDER.NAME),
                  r.get(EMAIL_ACCOUNT.PROVIDER),
                  r.get(EMAIL_MESSAGE.PROVIDER_MESSAGE_ID),
                  r.get(EMAIL_ATTACHMENT.PROVIDER_ATTACHMENT_ID));
            });
  }

  /**
   * 메시지에 첨부 메타 1건 저장. content_attachment(content_id, ordinal) find-or-create 후 링크·ordinal 기록.
   *
   * <p>Graph 첨부의 경우 provider_attachment_id 도 저장한다(IMAP 은 null). filename/content_type/size_bytes 등은
   * content_attachment 에 기록하며 email_attachment 에는 설정하지 않는다(V101 에서 컬럼 제거 예정).
   */
  public void insert(long messageId, long contentId, int ordinal, ParsedAttachment a) {
    long contentAttachmentId =
        contentAttachmentRepo.findOrCreate(
            contentId, ordinal, a.filename(), a.contentType(), a.sizeBytes(), a.contentId());
    dsl.insertInto(EMAIL_ATTACHMENT)
        .set(EMAIL_ATTACHMENT.MESSAGE_ID, messageId)
        .set(EMAIL_ATTACHMENT.ORDINAL, ordinal)
        .set(EMAIL_ATTACHMENT.CONTENT_ATTACHMENT_ID, contentAttachmentId)
        .set(EMAIL_ATTACHMENT.PROVIDER_ATTACHMENT_ID, a.providerAttachmentId())
        .execute();
  }
}
