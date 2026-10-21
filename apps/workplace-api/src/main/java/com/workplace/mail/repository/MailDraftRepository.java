package com.workplace.mail.repository;

import static com.workplace.jooq.Tables.EMAIL_ACCOUNT;
import static com.workplace.jooq.Tables.FILE;
import static com.workplace.jooq.Tables.MAIL_DRAFT;
import static com.workplace.jooq.Tables.MAIL_DRAFT_ATTACHMENT;
import static com.workplace.jooq.Tables.MAIL_DRAFT_FORWARD;

import com.workplace.file.api.StagedFileClaimer;
import com.workplace.mail.dto.MailDraftDetail;
import com.workplace.mail.dto.MailDraftDetail.Attachment;
import com.workplace.mail.dto.MailDraftSaved;
import com.workplace.mail.dto.MailDraftSummary;
import com.workplace.mail.dto.MailDraftVersion;
import java.time.OffsetDateTime;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
import org.jooq.Field;
import org.jooq.impl.DSL;
import org.springframework.stereotype.Repository;

/**
 * 메일 임시저장(WP-577) 저장소 — mail_draft 와 두 정션(업로드 mail_draft_attachment, 전달 원본 mail_draft_forward).
 *
 * <p>모든 조회·수정은 user_id 로 소유를 건다(남의 id 는 없는 것과 같다). RLS 를 쓰므로 호출자의 트랜잭션(GUC) 안에서 불러야 한다.
 */
@Repository
@RequiredArgsConstructor
public class MailDraftRepository {

  /** 임시저장 업로드 바인딩 키 — 발송이 내 임시저장에 묶인 업로드를 다시 가져올 때 클레이머에 넘긴다(정션 표 이름). */
  public static final String UPLOAD_BINDING = MAIL_DRAFT_ATTACHMENT.getName();

  private final DSLContext dsl;

  /** 저장할 값(서비스가 정규화한 것). */
  public record Fields(
      long accountId,
      String mode,
      List<String> to,
      List<String> cc,
      List<String> bcc,
      String subject,
      String bodyHtml,
      String preview,
      Long sourceMessageId,
      boolean quoteRemoved) {}

  /** 상세 조회용 행 — 첨부는 서비스가 따로 붙인다. */
  public record DraftRow(
      long id,
      long accountId,
      String mode,
      List<String> to,
      List<String> cc,
      List<String> bcc,
      String subject,
      String bodyHtml,
      Long sourceMessageId,
      boolean quoteRemoved,
      int version,
      OffsetDateTime updatedAt) {}

  /** 새 임시저장 — 버전 1. */
  public MailDraftSaved insert(long userId, Fields f) {
    var r =
        dsl.insertInto(MAIL_DRAFT)
            .set(MAIL_DRAFT.USER_ID, userId)
            .set(MAIL_DRAFT.ACCOUNT_ID, f.accountId())
            .set(MAIL_DRAFT.MODE, f.mode())
            .set(MAIL_DRAFT.TO_ADDRS, f.to().toArray(String[]::new))
            .set(MAIL_DRAFT.CC_ADDRS, f.cc().toArray(String[]::new))
            .set(MAIL_DRAFT.BCC_ADDRS, f.bcc().toArray(String[]::new))
            .set(MAIL_DRAFT.SUBJECT, f.subject())
            .set(MAIL_DRAFT.BODY_HTML, f.bodyHtml())
            .set(MAIL_DRAFT.PREVIEW, f.preview())
            .set(MAIL_DRAFT.SOURCE_MESSAGE_ID, f.sourceMessageId())
            .set(MAIL_DRAFT.QUOTE_REMOVED, f.quoteRemoved())
            .returning(MAIL_DRAFT.ID, MAIL_DRAFT.VERSION, MAIL_DRAFT.UPDATED_AT)
            .fetchOne();
    return new MailDraftSaved(r.getId(), r.getVersion(), r.getUpdatedAt());
  }

  /**
   * 버전이 맞을 때만 고친다(낙관적 잠금) — 버전 +1, 갱신 시각 지금. 행을 잠그므로 같은 임시저장의 동시 저장은 줄을 서고, 뒤 요청은 버전이 달라 빈 결과가 된다.
   *
   * @return 새 버전. 없거나 남의 것이거나 버전이 다르면 빈 값(서비스가 {@link #exists} 로 404·409 를 가른다)
   */
  public Optional<MailDraftVersion> updateIfVersion(
      long userId, long draftId, int expectedVersion, Fields f) {
    return dsl.update(MAIL_DRAFT)
        .set(MAIL_DRAFT.ACCOUNT_ID, f.accountId())
        .set(MAIL_DRAFT.MODE, f.mode())
        .set(MAIL_DRAFT.TO_ADDRS, f.to().toArray(String[]::new))
        .set(MAIL_DRAFT.CC_ADDRS, f.cc().toArray(String[]::new))
        .set(MAIL_DRAFT.BCC_ADDRS, f.bcc().toArray(String[]::new))
        .set(MAIL_DRAFT.SUBJECT, f.subject())
        .set(MAIL_DRAFT.BODY_HTML, f.bodyHtml())
        .set(MAIL_DRAFT.PREVIEW, f.preview())
        .set(MAIL_DRAFT.SOURCE_MESSAGE_ID, f.sourceMessageId())
        .set(MAIL_DRAFT.QUOTE_REMOVED, f.quoteRemoved())
        .set(MAIL_DRAFT.VERSION, MAIL_DRAFT.VERSION.plus(1))
        .set(MAIL_DRAFT.UPDATED_AT, DSL.currentOffsetDateTime())
        .where(MAIL_DRAFT.ID.eq(draftId))
        .and(MAIL_DRAFT.USER_ID.eq(userId))
        .and(MAIL_DRAFT.VERSION.eq(expectedVersion))
        .returning(MAIL_DRAFT.VERSION, MAIL_DRAFT.UPDATED_AT)
        .fetchOptional()
        .map(r -> MailDraftVersion.of(r.getVersion(), r.getUpdatedAt()));
  }

  /** 내 임시저장이 있는가(계정 상태와 무관). */
  public boolean exists(long userId, long draftId) {
    return dsl.fetchExists(
        MAIL_DRAFT, MAIL_DRAFT.ID.eq(draftId).and(MAIL_DRAFT.USER_ID.eq(userId)));
  }

  /** 내 계정의 임시저장 목록 — 갱신 최신순(같으면 id 큰 것 먼저), 최대 limit 건. 본문 HTML 은 읽지 않는다. */
  public List<MailDraftSummary> listByAccount(long userId, long accountId, int limit) {
    Field<Integer> uploads =
        DSL.selectCount()
            .from(MAIL_DRAFT_ATTACHMENT)
            .where(MAIL_DRAFT_ATTACHMENT.DRAFT_ID.eq(MAIL_DRAFT.ID))
            .asField("uploads");
    Field<Integer> forwards =
        DSL.selectCount()
            .from(MAIL_DRAFT_FORWARD)
            .where(MAIL_DRAFT_FORWARD.DRAFT_ID.eq(MAIL_DRAFT.ID))
            .asField("forwards");
    return dsl.select(
            MAIL_DRAFT.ID,
            MAIL_DRAFT.ACCOUNT_ID,
            MAIL_DRAFT.MODE,
            MAIL_DRAFT.TO_ADDRS,
            MAIL_DRAFT.SUBJECT,
            MAIL_DRAFT.PREVIEW,
            MAIL_DRAFT.UPDATED_AT,
            uploads,
            forwards)
        .from(MAIL_DRAFT)
        .where(MAIL_DRAFT.USER_ID.eq(userId))
        .and(MAIL_DRAFT.ACCOUNT_ID.eq(accountId))
        .orderBy(MAIL_DRAFT.UPDATED_AT.desc(), MAIL_DRAFT.ID.desc())
        .limit(limit)
        .fetch(
            r ->
                new MailDraftSummary(
                    r.get(MAIL_DRAFT.ID),
                    r.get(MAIL_DRAFT.ACCOUNT_ID),
                    r.get(MAIL_DRAFT.MODE),
                    List.of(r.get(MAIL_DRAFT.TO_ADDRS)),
                    r.get(MAIL_DRAFT.SUBJECT),
                    r.get(MAIL_DRAFT.PREVIEW),
                    r.get(uploads) + r.get(forwards),
                    r.get(MAIL_DRAFT.UPDATED_AT)));
  }

  /** 내 계정의 임시저장 개수(배지). */
  public long countByAccount(long userId, long accountId) {
    return dsl.fetchCount(
        MAIL_DRAFT, MAIL_DRAFT.USER_ID.eq(userId).and(MAIL_DRAFT.ACCOUNT_ID.eq(accountId)));
  }

  /** 내 임시저장 상세 — 계정이 비활성(삭제 대기)이면 없는 것으로 본다(목록과 같은 기준). */
  public Optional<DraftRow> findOwned(long userId, long draftId) {
    return dsl.select(MAIL_DRAFT.fields())
        .from(MAIL_DRAFT)
        .join(EMAIL_ACCOUNT)
        .on(EMAIL_ACCOUNT.ID.eq(MAIL_DRAFT.ACCOUNT_ID))
        .where(MAIL_DRAFT.ID.eq(draftId))
        .and(MAIL_DRAFT.USER_ID.eq(userId))
        .and(EMAIL_ACCOUNT.DISABLED_AT.isNull())
        .fetchOptional(
            r ->
                new DraftRow(
                    r.get(MAIL_DRAFT.ID),
                    r.get(MAIL_DRAFT.ACCOUNT_ID),
                    r.get(MAIL_DRAFT.MODE),
                    List.of(r.get(MAIL_DRAFT.TO_ADDRS)),
                    List.of(r.get(MAIL_DRAFT.CC_ADDRS)),
                    List.of(r.get(MAIL_DRAFT.BCC_ADDRS)),
                    r.get(MAIL_DRAFT.SUBJECT),
                    r.get(MAIL_DRAFT.BODY_HTML),
                    r.get(MAIL_DRAFT.SOURCE_MESSAGE_ID),
                    r.get(MAIL_DRAFT.QUOTE_REMOVED),
                    r.get(MAIL_DRAFT.VERSION),
                    r.get(MAIL_DRAFT.UPDATED_AT)));
  }

  /** 임시저장에 묶인 업로드 file id — 묶은 순서. */
  public List<Long> boundFileIds(long draftId) {
    return dsl.select(MAIL_DRAFT_ATTACHMENT.FILE_ID)
        .from(MAIL_DRAFT_ATTACHMENT)
        .where(MAIL_DRAFT_ATTACHMENT.DRAFT_ID.eq(draftId))
        .orderBy(MAIL_DRAFT_ATTACHMENT.ID)
        .fetch(MAIL_DRAFT_ATTACHMENT.FILE_ID);
  }

  /**
   * 파일을 내 임시저장(어느 것이든) 정션에서 빼고 만료를 expiresAt 으로 건다 — 저장이 내 다른 임시저장의 업로드를 옮겨 묶기 전(임시로 풀어 평범한 클레임을
   * 받게), 발송 성공 뒤(보낸 업로드를 남은 임시저장에서 빼기) 같은 정의로 쓴다. 만료는 ATTACHMENT 범주만 바꾼다 — 보류(발송 중·소비)된 파일은 그대로라
   * 저장의 뒤이은 클레임이 거절한다. 남의 임시저장·남의 파일은 건드리지 않는다.
   */
  public void releaseFromOwnedDrafts(
      long userId, Collection<Long> fileIds, OffsetDateTime expiresAt) {
    if (fileIds.isEmpty()) {
      return;
    }
    var ownedDraftIds =
        DSL.select(MAIL_DRAFT.ID).from(MAIL_DRAFT).where(MAIL_DRAFT.USER_ID.eq(userId));
    dsl.update(FILE)
        .set(FILE.EXPIRES_AT, expiresAt)
        .where(FILE.ID.in(fileIds))
        .and(FILE.UPLOADED_BY.eq(userId))
        .and(FILE.CATEGORY.eq(StagedFileClaimer.CATEGORY_ATTACHMENT))
        .and(
            FILE.ID.in(
                DSL.select(MAIL_DRAFT_ATTACHMENT.FILE_ID)
                    .from(MAIL_DRAFT_ATTACHMENT)
                    .where(MAIL_DRAFT_ATTACHMENT.DRAFT_ID.in(ownedDraftIds))))
        .execute();
    dsl.deleteFrom(MAIL_DRAFT_ATTACHMENT)
        .where(MAIL_DRAFT_ATTACHMENT.FILE_ID.in(fileIds))
        .and(MAIL_DRAFT_ATTACHMENT.DRAFT_ID.in(ownedDraftIds))
        .execute();
  }

  /** 업로드를 임시저장에 묶는다(호출자가 같은 트랜잭션에서 먼저 PERMANENT 클레임해야 한다). */
  public void bindFiles(long draftId, List<Long> fileIds) {
    if (fileIds.isEmpty()) {
      return;
    }
    var insert =
        dsl.insertInto(
            MAIL_DRAFT_ATTACHMENT, MAIL_DRAFT_ATTACHMENT.DRAFT_ID, MAIL_DRAFT_ATTACHMENT.FILE_ID);
    for (Long id : fileIds) {
      insert = insert.values(draftId, id);
    }
    insert.execute();
  }

  /**
   * 임시저장에서 빠진 업로드를 풀어 다시 임시 파일로 만든다 — 만료 = expiresAt(보통 지금 + 24시간), 정션 행 삭제. 보류(발송 중) 파일은 건드리지 않고
   * 묶인 채 둔다 — 풀면 그 발송이 실패해 보류가 되돌려질 때 만료 없는 고아가 된다.
   *
   * @return 실제로 푼 파일 id
   */
  public List<Long> releaseFiles(
      long userId, long draftId, Collection<Long> fileIds, OffsetDateTime expiresAt) {
    if (fileIds.isEmpty()) {
      return List.of();
    }
    List<Long> released =
        dsl.update(FILE)
            .set(FILE.EXPIRES_AT, expiresAt)
            .where(FILE.ID.in(fileIds))
            .and(FILE.UPLOADED_BY.eq(userId))
            .and(FILE.CATEGORY.eq(StagedFileClaimer.CATEGORY_ATTACHMENT))
            .and(
                FILE.ID.in(
                    DSL.select(MAIL_DRAFT_ATTACHMENT.FILE_ID)
                        .from(MAIL_DRAFT_ATTACHMENT)
                        .where(MAIL_DRAFT_ATTACHMENT.DRAFT_ID.eq(draftId))))
            .returning(FILE.ID)
            .fetch(FILE.ID);
    if (!released.isEmpty()) {
      dsl.deleteFrom(MAIL_DRAFT_ATTACHMENT)
          .where(MAIL_DRAFT_ATTACHMENT.DRAFT_ID.eq(draftId))
          .and(MAIL_DRAFT_ATTACHMENT.FILE_ID.in(released))
          .execute();
    }
    return released;
  }

  /**
   * 내 임시저장을 지운다 — 묶인 업로드에 expiresAt 만료를 걸어 만료 스윕이 정리하게 하고(보류 중인 것은 그 발송이 정리한다), 정션은 CASCADE 로 사라진다.
   * 사용자가 버린 것은 「되돌리기」가 같은 업로드로 다시 만들 수 있게 임시 수명(24시간)을, 발송 뒤 정리는 지금을 넘긴다.
   *
   * @param expiresAt 묶였던 업로드에 걸 만료 시각
   * @return 지웠으면 true, 없거나 남의 것이면 false
   */
  public boolean deleteOwned(long userId, long draftId, OffsetDateTime expiresAt) {
    // 행을 먼저 잠가 같은 임시저장의 동시 저장(새 업로드 묶기)과 엇갈리지 않게 한다.
    Long locked =
        dsl.select(MAIL_DRAFT.ID)
            .from(MAIL_DRAFT)
            .where(MAIL_DRAFT.ID.eq(draftId))
            .and(MAIL_DRAFT.USER_ID.eq(userId))
            .forUpdate()
            .fetchOne(MAIL_DRAFT.ID);
    if (locked == null) {
      return false;
    }
    dsl.update(FILE)
        // 앱 시각 기준 만료(호출자가 계산) — 만료 스윕·클레임 판정이 앱 시각(OffsetDateTime.now())과 비교하므로 DB 시계와 섞지 않는다.
        .set(FILE.EXPIRES_AT, expiresAt)
        .where(FILE.UPLOADED_BY.eq(userId))
        .and(FILE.CATEGORY.eq(StagedFileClaimer.CATEGORY_ATTACHMENT))
        .and(
            FILE.ID.in(
                DSL.select(MAIL_DRAFT_ATTACHMENT.FILE_ID)
                    .from(MAIL_DRAFT_ATTACHMENT)
                    .where(MAIL_DRAFT_ATTACHMENT.DRAFT_ID.eq(draftId))))
        .execute();
    dsl.deleteFrom(MAIL_DRAFT).where(MAIL_DRAFT.ID.eq(draftId)).execute();
    return true;
  }

  /**
   * 계정 하드 삭제 전 정리 — 그 계정 임시저장에 묶인 업로드를 지금 만료시킨다. 하드 삭제의 CASCADE 는 정션만 지우고 FILE 은 영구로 남기므로, 먼저 만료를
   * 걸어야 만료 스윕이 지운다. AccountPurgeService 의 트랜잭션 안에서 부른다.
   */
  public int expireBoundFilesOfAccount(long accountId) {
    return dsl.update(FILE)
        // 앱 시각으로 만료 — 만료 스윕·클레임 판정이 앱 시각(OffsetDateTime.now())과 비교하므로 DB 시계와 섞지 않는다.
        .set(FILE.EXPIRES_AT, OffsetDateTime.now())
        .where(FILE.CATEGORY.eq(StagedFileClaimer.CATEGORY_ATTACHMENT))
        .and(
            FILE.ID.in(
                DSL.select(MAIL_DRAFT_ATTACHMENT.FILE_ID)
                    .from(MAIL_DRAFT_ATTACHMENT)
                    .join(MAIL_DRAFT)
                    .on(MAIL_DRAFT.ID.eq(MAIL_DRAFT_ATTACHMENT.DRAFT_ID))
                    .where(MAIL_DRAFT.ACCOUNT_ID.eq(accountId))))
        .execute();
  }

  /**
   * 묶임이 사라진 영구 업로드를 다시 임시로 — 발송 실패로 보류를 되돌렸는데(원래 만료 NULL) 그 사이 임시저장이 지워졌거나 그 파일이 빠졌으면, 만료 없는 고아가 되지
   * 않게 만료를 건다. 아직 묶여 있으면 그대로 둔다.
   */
  public int expireUnboundPermanent(long userId, Collection<Long> fileIds, OffsetDateTime at) {
    if (fileIds.isEmpty()) {
      return 0;
    }
    return dsl.update(FILE)
        .set(FILE.EXPIRES_AT, at)
        .where(FILE.ID.in(fileIds))
        .and(FILE.UPLOADED_BY.eq(userId))
        .and(FILE.CATEGORY.eq(StagedFileClaimer.CATEGORY_ATTACHMENT))
        .and(FILE.EXPIRES_AT.isNull())
        .andNotExists(
            DSL.selectOne()
                .from(MAIL_DRAFT_ATTACHMENT)
                .where(MAIL_DRAFT_ATTACHMENT.FILE_ID.eq(FILE.ID)))
        .execute();
  }

  /** 상세의 업로드 첨부 — 묶은 순서. */
  public List<Attachment> uploadAttachments(long draftId) {
    return dsl.select(FILE.ID, FILE.ORIGINAL_NAME, FILE.SIZE_BYTES, FILE.MIME_TYPE)
        .from(MAIL_DRAFT_ATTACHMENT)
        .join(FILE)
        .on(FILE.ID.eq(MAIL_DRAFT_ATTACHMENT.FILE_ID))
        .where(MAIL_DRAFT_ATTACHMENT.DRAFT_ID.eq(draftId))
        .orderBy(MAIL_DRAFT_ATTACHMENT.ID)
        .fetch(
            r ->
                new Attachment(
                    r.get(FILE.ID),
                    r.get(FILE.ORIGINAL_NAME),
                    r.get(FILE.SIZE_BYTES),
                    r.get(FILE.MIME_TYPE),
                    MailDraftDetail.SOURCE_UPLOAD));
  }

  /** 전달 원본 첨부 id — 저장 순서. 원본이 지워진 것은 CASCADE 로 이미 빠져 있다. */
  public List<Long> forwardIds(long draftId) {
    return dsl.select(MAIL_DRAFT_FORWARD.EMAIL_ATTACHMENT_ID)
        .from(MAIL_DRAFT_FORWARD)
        .where(MAIL_DRAFT_FORWARD.DRAFT_ID.eq(draftId))
        .orderBy(MAIL_DRAFT_FORWARD.ID)
        .fetch(MAIL_DRAFT_FORWARD.EMAIL_ATTACHMENT_ID);
  }

  /** 전달 원본 첨부 참조를 더한다(저장 순서대로). */
  public void addForwards(long draftId, Collection<Long> attachmentIds) {
    if (attachmentIds.isEmpty()) {
      return;
    }
    var insert =
        dsl.insertInto(
            MAIL_DRAFT_FORWARD,
            MAIL_DRAFT_FORWARD.DRAFT_ID,
            MAIL_DRAFT_FORWARD.EMAIL_ATTACHMENT_ID);
    for (Long id : attachmentIds) {
      insert = insert.values(draftId, id);
    }
    insert.execute();
  }

  /** 전달 원본 첨부 참조를 뺀다. */
  public void removeForwards(long draftId, Collection<Long> attachmentIds) {
    if (attachmentIds.isEmpty()) {
      return;
    }
    dsl.deleteFrom(MAIL_DRAFT_FORWARD)
        .where(MAIL_DRAFT_FORWARD.DRAFT_ID.eq(draftId))
        .and(MAIL_DRAFT_FORWARD.EMAIL_ATTACHMENT_ID.in(attachmentIds))
        .execute();
  }
}
