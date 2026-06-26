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

/**
 * EmailMessageRepository.listRecentUnreadUnclassifiedIds 통합 테스트. 안읽음·미분류·INBOX 조건에 맞는 메시지 id 만
 * 반환하고, 읽은/분류완료 메시지는 제외되는지 검증한다.
 */
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
                com.workplace.jooq.tables.EmailMessage.EMAIL_MESSAGE.SUBJECT,
                com.workplace.jooq.tables.EmailMessage.EMAIL_MESSAGE.SNIPPET,
                com.workplace.jooq.tables.EmailMessage.EMAIL_MESSAGE.SEEN,
                com.workplace.jooq.tables.EmailMessage.EMAIL_MESSAGE.HAS_ATTACHMENT,
                com.workplace.jooq.tables.EmailMessage.EMAIL_MESSAGE.RECEIVED_AT)
            .values(
                accountId,
                folderId,
                "msg-" + System.nanoTime() + "@test.local",
                "thread-" + System.nanoTime(),
                "sender@example.com",
                "테스트 제목",
                "스니펫",
                seen,
                false,
                java.time.OffsetDateTime.ofInstant(Instant.now(), java.time.ZoneOffset.UTC))
            .returning(com.workplace.jooq.tables.EmailMessage.EMAIL_MESSAGE.ID)
            .fetchOne()
            .get(com.workplace.jooq.tables.EmailMessage.EMAIL_MESSAGE.ID);
    // aiNeedsReply 가 명시된 경우 updateClassification 으로 반영(null 은 그대로 두어 미분류 상태 유지)
    if (aiNeedsReply != null) {
      messageRepo.updateClassification(id, "업무", aiNeedsReply);
    }
    return id;
  }

  /** 안읽음·미분류(null) 메시지만 포함하고, 분류완료(true)·읽음(seen=true)은 제외되는지 검증. */
  @Test
  void listRecentUnreadUnclassifiedIds_filters_correctly() {
    long userId = TestFixtures.createHuman(dsl);
    long accountId = createAccountWithInbox(userId);
    long folderId = folderRepo.ensureFolder(accountId, "INBOX").id();

    long target = insertMessage(accountId, folderId, /*seen*/ false, /*aiNeedsReply*/ null); // 포함
    insertMessage(accountId, folderId, /*seen*/ false, /*aiNeedsReply*/ Boolean.TRUE); // 제외(분류완료)
    insertMessage(accountId, folderId, /*seen*/ true, /*aiNeedsReply*/ null); // 제외(읽음)

    List<Long> ids = messageRepo.listRecentUnreadUnclassifiedIds(accountId, 50);

    assertThat(ids).containsExactly(target);
  }
}
