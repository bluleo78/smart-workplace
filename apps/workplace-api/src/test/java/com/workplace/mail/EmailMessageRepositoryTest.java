package com.workplace.mail;

import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.global.security.EncryptionService;
import com.workplace.mail.dto.EmailAccountRequest;
import com.workplace.mail.dto.MailSecurity;
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

/** EmailMessageRepository — 미요약 안읽은 메일 조회 쿼리 통합 테스트. 공유 test DB 환경 — 테스트별 트랜잭션 롤백으로 격리. */
@Transactional
class EmailMessageRepositoryTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired EmailAccountRepository accountRepo;
  @Autowired EmailFolderRepository folderRepo;
  @Autowired EmailMessageRepository messageRepo;
  @Autowired EncryptionService encryption;

  /** 테스트용 이메일 계정 생성 헬퍼. */
  private long createAccount(long userId, String email) {
    EmailAccountRequest req =
        new EmailAccountRequest(
            email,
            "표시명",
            "127.0.0.1",
            3143,
            MailSecurity.NONE,
            email,
            "127.0.0.1",
            3025,
            MailSecurity.NONE,
            email,
            "pw",
            false);
    return accountRepo.insert(userId, req, encryption.encrypt("pw"));
  }

  /**
   * 테스트용 메시지를 지정 폴더에 삽입하고 생성된 id 반환.
   *
   * @param seen true=읽음, false=안읽음
   * @param aiSummary null=미요약, 문자열=요약 있음
   */
  private long seedMessage(long accountId, long folderId, boolean seen, String aiSummary) {
    var msg =
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

    if (aiSummary != null) {
      messageRepo.updateSummary(msg, aiSummary);
    }
    return msg;
  }

  /** listRecentUnreadUnsummarizedIds — 안읽음·미요약 메일만 반환하고, 요약 있음과 읽음 메일은 제외한다. */
  @Test
  void listRecentUnreadUnsummarizedIds_안읽음_미요약만_반환() {
    // given: 계정 + INBOX 폴더 시드, 메일 3건
    long userId = TestFixtures.createHuman(dsl);
    long accountId = createAccount(userId, "unsummarized-test@test.local");
    long folderId = folderRepo.ensureFolder(accountId, "INBOX").id();

    long unreadUnsummarized = seedMessage(accountId, folderId, false, null); // (a) 포함 대상
    seedMessage(accountId, folderId, false, "이미 요약"); // (b) 요약 있음 — 제외
    seedMessage(accountId, folderId, true, null); // (c) 읽음 — 제외

    // when
    List<Long> ids = messageRepo.listRecentUnreadUnsummarizedIds(accountId, 20);

    // then
    assertThat(ids).containsExactly(unreadUnsummarized);
  }

  /** P2: listByAccount — category/needsReply 필터 + done_at 제외 검증. */
  @Test
  void listByAccount_filtersByCategoryAndNeedsReply() {
    long userId = TestFixtures.createHuman(dsl);
    long accountId = createAccount(userId, "f@test.local");
    long inbox = folderRepo.ensureFolder(accountId, "INBOX").id();
    long work = seedMessage(accountId, inbox, false, null);
    long promo = seedMessage(accountId, inbox, false, null);
    long workDone = seedMessage(accountId, inbox, false, null);
    messageRepo.updateClassification(work, "업무", true);
    messageRepo.updateClassification(promo, "프로모션", false);
    messageRepo.updateClassification(workDone, "업무", true);
    messageRepo.markNeedsReplyDone(workDone, accountId); // 처리완료된 회신필요

    // category=업무 → work, workDone (2건)
    var byCat = messageRepo.listByAccount(accountId, "INBOX", null, false, "업무", false, 50);
    assertThat(byCat)
        .extracting(com.workplace.mail.dto.EmailMessageSummary::id)
        .containsExactlyInAnyOrder(work, workDone);

    // needsReply=true → work 만 (workDone 은 done_at 으로 제외)
    var byReply = messageRepo.listByAccount(accountId, "INBOX", null, false, null, true, 50);
    assertThat(byReply)
        .extracting(com.workplace.mail.dto.EmailMessageSummary::id)
        .containsExactly(work);
  }

  /** P2: markNeedsReplyDone — 처리완료가 3 소비처(목록·계정카운트·홈카운트)에서 동시에 빠지는지 검증. */
  @Test
  void markNeedsReplyDone_removesFromAllNeedsReplyConsumers() {
    long userId = TestFixtures.createHuman(dsl);
    long accountId = createAccount(userId, "g@test.local");
    long inbox = folderRepo.ensureFolder(accountId, "INBOX").id();
    long m = seedMessage(accountId, inbox, false, null); // seen=false
    messageRepo.updateClassification(m, "업무", true);

    assertThat(messageRepo.countNeedsReplyForAccount(accountId)).isEqualTo(1);
    assertThat(messageRepo.countNeedsReply(userId)).isEqualTo(1);

    assertThat(messageRepo.markNeedsReplyDone(m, accountId)).isEqualTo(1);

    assertThat(messageRepo.listByAccount(accountId, "INBOX", null, false, null, true, 50))
        .isEmpty();
    assertThat(messageRepo.countNeedsReplyForAccount(accountId)).isZero();
    assertThat(messageRepo.countNeedsReply(userId)).isZero();

    // 되돌리기 → 복귀
    assertThat(messageRepo.clearNeedsReplyDone(m, accountId)).isEqualTo(1);
    assertThat(messageRepo.countNeedsReplyForAccount(accountId)).isEqualTo(1);
  }
}
