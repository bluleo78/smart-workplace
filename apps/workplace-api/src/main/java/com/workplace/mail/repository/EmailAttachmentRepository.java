package com.workplace.mail.repository;

import static com.workplace.jooq.Tables.CONTENT_ATTACHMENT;
import static com.workplace.jooq.Tables.EMAIL_ACCOUNT;
import static com.workplace.jooq.Tables.EMAIL_ATTACHMENT;
import static com.workplace.jooq.Tables.EMAIL_FOLDER;
import static com.workplace.jooq.Tables.EMAIL_MESSAGE;

import com.workplace.mail.dto.ParsedAttachment;
import java.util.List;
import java.util.Objects;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.jooq.Condition;
import org.jooq.DSLContext;
import org.jooq.Table;
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
    // find-or-create 는 기존 공유 행을 갱신하지 않는다 — 규칙 도입(WP-68) 전에 만들어진 행도 Content-ID 를 얻도록 보강
    if (a.contentId() != null) {
      contentAttachmentRepo.setMimeContentIdIfNull(contentAttachmentId, a.contentId());
    }
    dsl.insertInto(EMAIL_ATTACHMENT)
        .set(EMAIL_ATTACHMENT.MESSAGE_ID, messageId)
        .set(EMAIL_ATTACHMENT.ORDINAL, ordinal)
        .set(EMAIL_ATTACHMENT.CONTENT_ATTACHMENT_ID, contentAttachmentId)
        .set(EMAIL_ATTACHMENT.PROVIDER_ATTACHMENT_ID, a.providerAttachmentId())
        .execute();
  }

  /**
   * envelope 의 첨부 행을 모두 지운다(WP-130). 부분 적재로 남은 행이 이전 content 의 manifest 를 가리킨 채 남으면 목록에 엉뚱한 첨부가
   * 보이고, 그 content 의 고아 삭제가 RESTRICT FK 에 막힌다.
   */
  public void deleteByMessage(long messageId) {
    dsl.deleteFrom(EMAIL_ATTACHMENT).where(EMAIL_ATTACHMENT.MESSAGE_ID.eq(messageId)).execute();
  }

  /**
   * 첨부 목록을 envelope 첨부로 삽입한다. ordinal = 목록 인덱스(0-based) — content_attachment manifest 의 안정 좌표이자
   * {@link ContentAttachmentRepository#matchesManifest} 비교 기준.
   *
   * <p>교체 삽입: 이 envelope 의 기존 첨부 행을 먼저 지운다. 적재 중 실패(로더가 예외를 삼켜 커밋됨)로 남은 부분 행이 재시도 때 중복되거나, 분리 전
   * content 의 manifest 를 계속 가리키지 않게 한다. 호출 시점은 본문 미적재(fetched_at NULL) 또는 첨부 행이 없는 envelope 뿐이다.
   */
  public void insertAll(long messageId, long contentId, List<ParsedAttachment> attachments) {
    deleteByMessage(messageId);
    for (int i = 0; i < attachments.size(); i++) {
      insert(messageId, contentId, i, attachments.get(i));
    }
  }

  /**
   * Content-ID 지연 백필 후보(WP-68) — Graph 계정 소유 메시지의 이미지 첨부 중 mime_content_id 가 NULL 이고 단건 조회 가능한
   * (provider_attachment_id 보유) 소용량 행.
   *
   * @param userId 소유자(소유 검증 + 비활성 계정 제외)
   * @param messageId email_message.id
   * @param maxBytes 단건 조회 크기 상한(contentBytes 전송 비용 제한)
   */
  public List<ContentIdBackfillTarget> findContentIdBackfillTargets(
      long userId, long messageId, long maxBytes) {
    return dsl.select(
            CONTENT_ATTACHMENT.ID,
            EMAIL_MESSAGE.ACCOUNT_ID,
            EMAIL_MESSAGE.PROVIDER_MESSAGE_ID,
            EMAIL_ATTACHMENT.PROVIDER_ATTACHMENT_ID)
        .from(ownedAttachmentJoin())
        .where(ownedBy(userId))
        .and(EMAIL_ATTACHMENT.MESSAGE_ID.eq(messageId))
        .and(EMAIL_ACCOUNT.PROVIDER.eq("M365_GRAPH"))
        .and(EMAIL_MESSAGE.PROVIDER_MESSAGE_ID.isNotNull())
        .and(EMAIL_ATTACHMENT.PROVIDER_ATTACHMENT_ID.isNotNull())
        .and(CONTENT_ATTACHMENT.MIME_CONTENT_ID.isNull())
        .and(CONTENT_ATTACHMENT.CONTENT_TYPE.likeIgnoreCase("image/%"))
        .and(CONTENT_ATTACHMENT.SIZE_BYTES.le(maxBytes))
        .fetch(
            r ->
                new ContentIdBackfillTarget(
                    r.get(CONTENT_ATTACHMENT.ID),
                    r.get(EMAIL_MESSAGE.ACCOUNT_ID),
                    r.get(EMAIL_MESSAGE.PROVIDER_MESSAGE_ID),
                    r.get(EMAIL_ATTACHMENT.PROVIDER_ATTACHMENT_ID)));
  }

  /** Content-ID 백필 대상 1건 — 기록 위치(content_attachment)와 Graph 단건 조회 좌표. */
  public record ContentIdBackfillTarget(
      long contentAttachmentId,
      long accountId,
      String providerMessageId,
      String providerAttachmentId) {}

  /**
   * 인용문 인라인 이미지 재첨부용 메타(WP-69) — 발송 사전검증에서 바이트를 읽지 않고 소유·타입·크기를 판정한다. 소유 검증은 {@link
   * #findContextForDownload} 와 동일(account.user_id + 비활성 계정 제외).
   */
  public Optional<InlineSourceMeta> findInlineSourceMeta(long userId, long attachmentId) {
    return dsl.select(
            CONTENT_ATTACHMENT.FILENAME,
            CONTENT_ATTACHMENT.CONTENT_TYPE,
            CONTENT_ATTACHMENT.SIZE_BYTES)
        .from(ownedAttachmentJoin())
        .where(ownedBy(userId))
        .and(EMAIL_ATTACHMENT.ID.eq(attachmentId))
        .fetchOptional(
            r ->
                new InlineSourceMeta(
                    r.get(CONTENT_ATTACHMENT.FILENAME),
                    r.get(CONTENT_ATTACHMENT.CONTENT_TYPE),
                    Objects.requireNonNullElse(r.get(CONTENT_ATTACHMENT.SIZE_BYTES), 0L)));
  }

  /** 첨부 → manifest → 메시지 → 계정 조인(WP-68/69 조회 공용). */
  private static Table<?> ownedAttachmentJoin() {
    return EMAIL_ATTACHMENT
        .join(CONTENT_ATTACHMENT)
        .on(CONTENT_ATTACHMENT.ID.eq(EMAIL_ATTACHMENT.CONTENT_ATTACHMENT_ID))
        .join(EMAIL_MESSAGE)
        .on(EMAIL_MESSAGE.ID.eq(EMAIL_ATTACHMENT.MESSAGE_ID))
        .join(EMAIL_ACCOUNT)
        .on(EMAIL_ACCOUNT.ID.eq(EMAIL_MESSAGE.ACCOUNT_ID));
  }

  /** 소유 검증 — {@link #findContextForDownload} 와 같은 규칙(계정 소유자 + 비활성 계정 제외). */
  private static Condition ownedBy(long userId) {
    return EMAIL_ACCOUNT.USER_ID.eq(userId).and(EMAIL_ACCOUNT.DISABLED_AT.isNull());
  }

  /** 인라인 재첨부 원본 메타. */
  public record InlineSourceMeta(String filename, String contentType, long sizeBytes) {}

  /** 이 envelope 에 첨부 행이 하나라도 있는지(WP-68 인라인 전용 레거시 메일 적재 가드). */
  public boolean existsForMessage(long messageId) {
    return dsl.fetchExists(EMAIL_ATTACHMENT, EMAIL_ATTACHMENT.MESSAGE_ID.eq(messageId));
  }
}
