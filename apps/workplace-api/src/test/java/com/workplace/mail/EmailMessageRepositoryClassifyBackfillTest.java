package com.workplace.mail;

import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.global.security.EncryptionService;
import com.workplace.mail.repository.EmailAccountRepository;
import com.workplace.mail.repository.EmailFolderRepository;
import com.workplace.mail.repository.EmailMessageRepository;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.time.Instant;
import java.util.List;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/** WP-149 listRecentUnreadUnanalyzedIds — 안읽음·INBOX·④ 미분석·배포 전 미분류·본문 적재 완료만. */
@Transactional
class EmailMessageRepositoryClassifyBackfillTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired EmailAccountRepository accountRepo;
  @Autowired EmailFolderRepository folderRepo;
  @Autowired EmailMessageRepository messageRepo;
  @Autowired EncryptionService encryption;

  /** INBOX 가 있는 계정 생성 헬퍼. */
  private long createAccountWithInbox(long userId) {
    return MailTestSupport.insertAccount(accountRepo, encryption, userId, true);
  }

  /** INBOX 폴더에 메시지를 직접 삽입. seen·aiNeedsReply 를 파라미터로 제어해 필터 조합을 시드한다. */
  private long insertMessage(long accountId, long folderId, boolean seen, Boolean aiNeedsReply) {
    var id =
        dsl.insertInto(
                com.workplace.jooq.tables.EmailMessage.EMAIL_MESSAGE,
                com.workplace.jooq.tables.EmailMessage.EMAIL_MESSAGE.ACCOUNT_ID,
                com.workplace.jooq.tables.EmailMessage.EMAIL_MESSAGE.FOLDER_ID,
                com.workplace.jooq.tables.EmailMessage.EMAIL_MESSAGE.MESSAGE_ID,
                com.workplace.jooq.tables.EmailMessage.EMAIL_MESSAGE.THREAD_ID,
                com.workplace.jooq.tables.EmailMessage.EMAIL_MESSAGE.FROM_ADDRESS,
                // subject/snippet 은 email_content 로 이전(Task9: envelope 컬럼 제거)
                com.workplace.jooq.tables.EmailMessage.EMAIL_MESSAGE.SEEN,
                com.workplace.jooq.tables.EmailMessage.EMAIL_MESSAGE.HAS_ATTACHMENT,
                com.workplace.jooq.tables.EmailMessage.EMAIL_MESSAGE.RECEIVED_AT)
            .values(
                accountId,
                folderId,
                "msg-" + System.nanoTime() + "@test.local",
                "thread-" + System.nanoTime(),
                "sender@example.com",
                // subject/snippet 값 제거
                seen,
                false,
                java.time.OffsetDateTime.ofInstant(Instant.now(), java.time.ZoneOffset.UTC))
            .returning(com.workplace.jooq.tables.EmailMessage.EMAIL_MESSAGE.ID)
            .fetchOne()
            .get(com.workplace.jooq.tables.EmailMessage.EMAIL_MESSAGE.ID);
    // WP-130: 분류는 본문 적재·검증된 envelope 만 대상
    TestFixtures.markMailFetched(dsl, id);
    // aiNeedsReply 가 명시된 경우 updateClassification 으로 반영(null 은 그대로 두어 미분류 상태 유지)
    if (aiNeedsReply != null) {
      messageRepo.updateClassification(id, "업무", aiNeedsReply);
    }
    return id;
  }

  /** 안읽음·미분석·미분류·적재 완료만 포함. 배포 전 분류(ai_needs_reply 있음)·④ 시도함·읽음·본문 미적재는 제외. */
  @Test
  void listRecentUnreadUnanalyzedIds_filters_correctly() {
    long userId = TestFixtures.createHuman(dsl);
    long accountId = createAccountWithInbox(userId);
    long folderId = folderRepo.ensureFolder(accountId, "INBOX").id();

    long target = insertMessage(accountId, folderId, false, null); // 포함
    insertMessage(accountId, folderId, false, Boolean.TRUE); // 제외(배포 전 분류)
    insertMessage(accountId, folderId, true, null); // 제외(읽음)
    long analyzed = insertMessage(accountId, folderId, false, null);
    dsl.update(com.workplace.jooq.tables.EmailMessage.EMAIL_MESSAGE)
        .set(
            com.workplace.jooq.tables.EmailMessage.EMAIL_MESSAGE.AI_ANALYZED_AT,
            java.time.OffsetDateTime.now())
        .where(com.workplace.jooq.tables.EmailMessage.EMAIL_MESSAGE.ID.eq(analyzed))
        .execute(); // 제외(④ 시도함 — LLM 이 raw 를 냈지만 최종값이 아직 NULL 인 경우 포함)
    long unfetched = insertMessage(accountId, folderId, false, null);
    dsl.update(com.workplace.jooq.tables.EmailMessage.EMAIL_MESSAGE)
        .set(
            com.workplace.jooq.tables.EmailMessage.EMAIL_MESSAGE.FETCHED_AT,
            (java.time.OffsetDateTime) null)
        .where(com.workplace.jooq.tables.EmailMessage.EMAIL_MESSAGE.ID.eq(unfetched))
        .execute(); // 제외(본문 미적재·미검증 — WP-130, 판단 6)

    List<Long> ids = messageRepo.listRecentUnreadUnanalyzedIds(accountId, 50);

    assertThat(ids).containsExactly(target);
  }
}
