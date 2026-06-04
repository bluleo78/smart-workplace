package com.workplace.mail;

import static com.workplace.jooq.Tables.EMAIL_MESSAGE;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.global.security.EncryptionService;
import com.workplace.mail.dto.EmailAccountRequest;
import com.workplace.mail.dto.EmailMessageSummary;
import com.workplace.mail.dto.MailSecurity;
import com.workplace.mail.dto.OutgoingMail;
import com.workplace.mail.dto.ReplyContext;
import com.workplace.mail.repository.EmailAccountRepository;
import com.workplace.mail.repository.EmailFolderRepository;
import com.workplace.mail.repository.EmailMessageRepository;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/** insertSent·findReplyContext·폴더 스코핑(INBOX/SENT 분리) 검증. */
@Transactional
class MailSentRepositoryTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired EmailAccountRepository accountRepo;
  @Autowired EmailFolderRepository folderRepo;
  @Autowired EmailMessageRepository messageRepo;
  @Autowired EncryptionService encryption;

  private long account(long user) {
    EmailAccountRequest req =
        new EmailAccountRequest(
            "me@test.local",
            "나",
            "127.0.0.1",
            3143,
            MailSecurity.NONE,
            "me@test.local",
            "127.0.0.1",
            3025,
            MailSecurity.NONE,
            "me@test.local",
            "pw");
    return accountRepo.insert(user, req, encryption.encrypt("pw"));
  }

  private OutgoingMail outgoing(String messageId, String threadId) {
    return new OutgoingMail(
        messageId,
        threadId,
        "me@test.local",
        "나",
        List.of("rcpt@test.local"),
        List.of(),
        List.of("hidden@test.local"),
        "제목",
        "본문 텍스트",
        "<p>본문 텍스트</p>",
        null,
        null,
        "본문 텍스트",
        Instant.now());
  }

  @Test
  void insertSent_storesRowWithNullUidAndBcc() {
    long user = TestFixtures.createHuman(dsl);
    long accountId = account(user);
    long folderId = folderRepo.ensureFolder(accountId, "SENT").id();

    long id =
        messageRepo.insertSent(accountId, folderId, outgoing("m1@test.local", "m1@test.local"));

    assertThat(id).isPositive();
    List<EmailMessageSummary> sent = messageRepo.listByAccount(accountId, "SENT", null, 50);
    assertThat(sent).extracting(EmailMessageSummary::subject).containsExactly("제목");
    // SENT 행은 INBOX 목록에 새지 않는다.
    assertThat(messageRepo.listByAccount(accountId, "INBOX", null, 50)).isEmpty();

    // bcc 저장 검증: findDetailByIdAndUser 경로로 BCC 컬럼 확인.
    messageRepo
        .findDetailByIdAndUser(user, id)
        .ifPresent(d -> assertThat(d.bccAddresses()).isEqualTo("hidden@test.local"));

    // imap_uid 가 NULL 로 저장됐는지 직접 확인.
    Long uid =
        dsl.select(EMAIL_MESSAGE.IMAP_UID)
            .from(EMAIL_MESSAGE)
            .where(EMAIL_MESSAGE.ID.eq(id))
            .fetchOne(EMAIL_MESSAGE.IMAP_UID);
    assertThat(uid).isNull();
  }

  @Test
  void findReplyContext_returnsThreadAndReferences() {
    long user = TestFixtures.createHuman(dsl);
    long accountId = account(user);
    long folderId = folderRepo.ensureFolder(accountId, "SENT").id();
    long parentId =
        messageRepo.insertSent(accountId, folderId, outgoing("p@test.local", "thread-1"));

    Optional<ReplyContext> ctx = messageRepo.findReplyContextByIdAndUser(user, parentId);

    assertThat(ctx).isPresent();
    assertThat(ctx.get().threadId()).isEqualTo("thread-1");
    assertThat(ctx.get().parentMessageId()).isEqualTo("p@test.local");
  }
}
