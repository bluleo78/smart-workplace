package com.workplace.mail;

import static com.workplace.jooq.Tables.CALENDAR;
import static com.workplace.jooq.Tables.CALENDAR_EVENT;
import static com.workplace.jooq.Tables.CONTENT_ATTACHMENT;
import static com.workplace.jooq.Tables.EMAIL_ACCOUNT;
import static com.workplace.jooq.Tables.EMAIL_CONTENT;
import static com.workplace.jooq.Tables.EMAIL_MESSAGE;
import static com.workplace.jooq.Tables.MAIL_ATTACHMENT_BLOB;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.global.tenant.TenantContext;
import com.workplace.mail.service.AccountPurgeService;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.time.OffsetDateTime;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

/** 계정 purge 가 cascade + 공유 콘텐츠/blob GC + 교차계정 보존을 올바르게 수행하는지 검증. */
class AccountPurgeServiceTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired AccountPurgeService purgeService;
  @Autowired org.springframework.transaction.PlatformTransactionManager txManager;

  private static final long TENANT_ID = 1L;

  @BeforeEach
  void setUp() {
    TenantContext.set(TENANT_ID);
  }

  @AfterEach
  void tearDown() {
    TenantContext.clear();
  }

  @Test
  @DisplayName("purge 는 계정·메시지·캘린더·일정·미공유 본문·고아 blob 을 삭제하되 타 계정이 공유하는 본문/blob 은 보존한다")
  void purgeAccount_cascadesAndGcsButPreservesShared() {
    var tx = new org.springframework.transaction.support.TransactionTemplate(txManager);

    // 1) 셋업은 commit 되는 트랜잭션 안에서(=GUC 주입). purge 는 별도 tx 에서 이 행들을 봐야 하므로 rollback 금지.
    String soloHash = "solohash-" + System.nanoTime();
    String sharedHash = "sharedhash-" + System.nanoTime();
    long[] ids =
        tx.execute(
            status -> {
              long owner = TestFixtures.createHuman(dsl);
              long keepAcc = insertAccount(owner, null); // 활성 — 공유 본문/blob 보존 확인용
              long delAcc = insertAccount(owner, OffsetDateTime.now()); // soft-deleted — purge 대상
              long folderDel = insertFolder(delAcc);
              long folderKeep = insertFolder(keepAcc);
              long sharedContent = insertContent("shared-msgid"); // keepAcc·delAcc 둘 다 참조 → 보존
              insertMessage(delAcc, folderDel, sharedContent);
              insertMessage(keepAcc, folderKeep, sharedContent);
              long soloContent = insertContent("solo-msgid"); // delAcc 만 참조 → GC 삭제
              insertMessage(delAcc, folderDel, soloContent);

              // blob GC 커버리지: solo 콘텐츠는 soloHash 첨부만 참조 → blob GC 삭제,
              // shared 콘텐츠는 sharedHash 첨부 참조 → 보존(타 계정 메시지가 여전히 shared 콘텐츠 참조).
              insertAttachment(soloContent, 0, soloHash);
              insertAttachment(sharedContent, 0, sharedHash);
              insertBlob(soloHash, "blob/solo-" + System.nanoTime());
              insertBlob(sharedHash, "blob/shared-" + System.nanoTime());

              long extCal = insertCalendar(owner, delAcc); // cascade 삭제 대상
              long evt = insertEvent(owner, extCal);
              return new long[] {owner, keepAcc, delAcc, sharedContent, soloContent, extCal, evt};
            });
    long owner = ids[0], keepAcc = ids[1], delAcc = ids[2];
    long sharedContent = ids[3], soloContent = ids[4], extCal = ids[5], evt = ids[6];

    // 2) purge (자체 트랜잭션)
    purgeService.purgeAccount(owner, delAcc);

    // 3) 검증도 GUC 트랜잭션 안에서(트랜잭션 밖 bare fetch 는 fail-closed 로 false 위장 위험).
    tx.executeWithoutResult(
        status -> {
          assertThat(
                  dsl.fetchExists(
                      dsl.selectOne().from(EMAIL_ACCOUNT).where(EMAIL_ACCOUNT.ID.eq(delAcc))))
              .as("purge 후 계정 행 삭제")
              .isFalse();
          assertThat(
                  dsl.fetchExists(
                      dsl.selectOne().from(EMAIL_ACCOUNT).where(EMAIL_ACCOUNT.ID.eq(keepAcc))))
              .as("타 계정 보존")
              .isTrue();
          assertThat(dsl.fetchCount(EMAIL_MESSAGE, EMAIL_MESSAGE.ACCOUNT_ID.eq(delAcc)))
              .as("purge 계정 메시지 0")
              .isZero();
          assertThat(dsl.fetchExists(dsl.selectOne().from(CALENDAR).where(CALENDAR.ID.eq(extCal))))
              .as("외부 캘린더 삭제")
              .isFalse();
          assertThat(
                  dsl.fetchExists(
                      dsl.selectOne().from(CALENDAR_EVENT).where(CALENDAR_EVENT.ID.eq(evt))))
              .as("일정 cascade 삭제")
              .isFalse();
          assertThat(
                  dsl.fetchExists(
                      dsl.selectOne().from(EMAIL_CONTENT).where(EMAIL_CONTENT.ID.eq(soloContent))))
              .as("단독 본문 GC")
              .isFalse();
          assertThat(
                  dsl.fetchExists(
                      dsl.selectOne()
                          .from(EMAIL_CONTENT)
                          .where(EMAIL_CONTENT.ID.eq(sharedContent))))
              .as("공유 본문 보존(타 계정 메시지가 여전히 참조)")
              .isTrue();
          assertThat(
                  dsl.fetchExists(
                      dsl.selectOne()
                          .from(MAIL_ATTACHMENT_BLOB)
                          .where(MAIL_ATTACHMENT_BLOB.CONTENT_HASH.eq(soloHash))))
              .as("고아 blob GC(참조하던 content_attachment 가 cascade 로 사라짐)")
              .isFalse();
          assertThat(
                  dsl.fetchExists(
                      dsl.selectOne()
                          .from(MAIL_ATTACHMENT_BLOB)
                          .where(MAIL_ATTACHMENT_BLOB.CONTENT_HASH.eq(sharedHash))))
              .as("공유 blob 보존(공유 본문의 content_attachment 가 여전히 참조)")
              .isTrue();
        });

    // 4) 정리: 테스트 DB 누적/공유상태 오염 방지(#512). purge 후 보존된 공유 본문·공유 blob 은
    //    user cascade 로 정리되지 않으므로(mail_attachment_blob 은 user FK 없음) 명시 삭제한다.
    //    순서: owner 사용자 삭제(→ keepAcc·메시지·캘린더 cascade) → 잔존 공유 content(+content_attachment cascade)
    //    → 잔존 공유/단독 blob(hash 키).
    cleanupInTenant(
        TENANT_ID,
        () -> {
          dsl.deleteFrom(com.workplace.jooq.Tables.USER)
              .where(com.workplace.jooq.Tables.USER.ID.eq(owner))
              .execute();
          dsl.deleteFrom(EMAIL_CONTENT)
              .where(EMAIL_CONTENT.ID.in(sharedContent, soloContent))
              .execute();
          dsl.deleteFrom(MAIL_ATTACHMENT_BLOB)
              .where(MAIL_ATTACHMENT_BLOB.CONTENT_HASH.in(soloHash, sharedHash))
              .execute();
        });
  }

  // --- fixtures ---
  private long insertAccount(long userId, OffsetDateTime disabledAt) {
    return dsl.insertInto(EMAIL_ACCOUNT)
        .set(EMAIL_ACCOUNT.USER_ID, userId)
        .set(EMAIL_ACCOUNT.EMAIL_ADDRESS, "acc-" + System.nanoTime() + "@example.com")
        .set(EMAIL_ACCOUNT.DISPLAY_NAME, "acc")
        .set(EMAIL_ACCOUNT.PROVIDER, "M365_GRAPH")
        .set(EMAIL_ACCOUNT.DISABLED_AT, disabledAt)
        .returning(EMAIL_ACCOUNT.ID)
        .fetchOne()
        .getId();
  }

  private long insertFolder(long accountId) {
    return dsl.insertInto(com.workplace.jooq.Tables.EMAIL_FOLDER)
        .set(com.workplace.jooq.Tables.EMAIL_FOLDER.ACCOUNT_ID, accountId)
        .set(com.workplace.jooq.Tables.EMAIL_FOLDER.NAME, "INBOX-" + System.nanoTime())
        .returning(com.workplace.jooq.Tables.EMAIL_FOLDER.ID)
        .fetchOne()
        .getId();
  }

  /** email_content: tenant_id(NO DEFAULT)·thread_id(NOT NULL) 모두 명시. */
  private long insertContent(String messageId) {
    return dsl.insertInto(EMAIL_CONTENT)
        .set(EMAIL_CONTENT.TENANT_ID, TENANT_ID)
        .set(EMAIL_CONTENT.MESSAGE_ID, messageId + "-" + System.nanoTime())
        .set(EMAIL_CONTENT.THREAD_ID, "t-" + System.nanoTime())
        .set(EMAIL_CONTENT.BODY_TEXT, "body")
        .returning(EMAIL_CONTENT.ID)
        .fetchOne()
        .getId();
  }

  /** email_message: subject 컬럼 없음(본문에 있음). thread_id NOT NULL. */
  private long insertMessage(long accountId, long folderId, long contentId) {
    return dsl.insertInto(EMAIL_MESSAGE)
        .set(EMAIL_MESSAGE.ACCOUNT_ID, accountId)
        .set(EMAIL_MESSAGE.FOLDER_ID, folderId)
        .set(EMAIL_MESSAGE.IMAP_UID, System.nanoTime())
        .set(EMAIL_MESSAGE.MESSAGE_ID, "m-" + System.nanoTime())
        .set(EMAIL_MESSAGE.THREAD_ID, "th-" + System.nanoTime())
        .set(EMAIL_MESSAGE.CONTENT_ID, contentId)
        .set(EMAIL_MESSAGE.SEEN, false)
        .returning(EMAIL_MESSAGE.ID)
        .fetchOne()
        .getId();
  }

  /** content_attachment: content_id·ordinal NOT NULL, content_hash 로 blob 연결. */
  private void insertAttachment(long contentId, int ordinal, String contentHash) {
    dsl.insertInto(CONTENT_ATTACHMENT)
        .set(CONTENT_ATTACHMENT.CONTENT_ID, contentId)
        .set(CONTENT_ATTACHMENT.ORDINAL, ordinal)
        .set(CONTENT_ATTACHMENT.FILENAME, "att.bin")
        .set(CONTENT_ATTACHMENT.CONTENT_HASH, contentHash)
        .execute();
  }

  private void insertBlob(String contentHash, String fileRef) {
    dsl.insertInto(MAIL_ATTACHMENT_BLOB)
        .set(MAIL_ATTACHMENT_BLOB.CONTENT_HASH, contentHash)
        .set(MAIL_ATTACHMENT_BLOB.FILE_REF, fileRef)
        .set(MAIL_ATTACHMENT_BLOB.SIZE_BYTES, 10L)
        .execute();
  }

  private long insertCalendar(long ownerId, long externalAccountId) {
    return dsl.insertInto(CALENDAR)
        .set(CALENDAR.OWNER_ID, ownerId)
        .set(CALENDAR.NAME, "cal")
        .set(CALENDAR.COLOR, "#3b82f6")
        .set(CALENDAR.IS_DEFAULT, false)
        .set(CALENDAR.POSITION, 0)
        .set(CALENDAR.EXTERNAL_ACCOUNT_ID, externalAccountId)
        .set(CALENDAR.EXTERNAL_ID, "ext-" + System.nanoTime())
        .returning(CALENDAR.ID)
        .fetchOne()
        .getId();
  }

  private long insertEvent(long ownerId, long calendarId) {
    return dsl.insertInto(CALENDAR_EVENT)
        .set(CALENDAR_EVENT.OWNER_ID, ownerId)
        .set(CALENDAR_EVENT.CALENDAR_ID, calendarId)
        .set(CALENDAR_EVENT.TITLE, "evt")
        .set(CALENDAR_EVENT.STARTS_AT, OffsetDateTime.parse("2026-06-15T10:00:00Z"))
        .set(CALENDAR_EVENT.ENDS_AT, OffsetDateTime.parse("2026-06-15T11:00:00Z"))
        .set(CALENDAR_EVENT.ALL_DAY, false)
        .returning(CALENDAR_EVENT.ID)
        .fetchOne()
        .getId();
  }
}
