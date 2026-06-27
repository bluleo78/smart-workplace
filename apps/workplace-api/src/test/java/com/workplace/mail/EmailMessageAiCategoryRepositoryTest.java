package com.workplace.mail;

import static com.workplace.jooq.Tables.EMAIL_MESSAGE;
import static com.workplace.jooq.tables.EmailContent.EMAIL_CONTENT;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.global.security.EncryptionService;
import com.workplace.mail.dto.EmailAccountRequest;
import com.workplace.mail.dto.EmailMessageSummary;
import com.workplace.mail.dto.MailSecurity;
import com.workplace.mail.dto.ParsedMessage;
import com.workplace.mail.repository.EmailAccountRepository;
import com.workplace.mail.repository.EmailContentRepository;
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

/** 슬라이스② 분류: ai_category 는 content 에서 읽히고, ai_needs_reply 는 envelope 잔류(#485 통일 술어). */
@Transactional
class EmailMessageAiCategoryRepositoryTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired EmailAccountRepository accountRepo;
  @Autowired EmailFolderRepository folderRepo;
  @Autowired EmailMessageRepository messageRepo;
  @Autowired EmailContentRepository contentRepo;
  @Autowired EncryptionService encryption;

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
            true);
    return accountRepo.insert(userId, req, encryption.encrypt("pw"));
  }

  private long insertMessage(long accountId, long folderId, String messageId) {
    ParsedMessage msg =
        new ParsedMessage(
            System.nanoTime(),
            messageId,
            "thread-" + messageId,
            null,
            null,
            "sender@example.com",
            null,
            null,
            null,
            "제목",
            Instant.now(),
            Instant.now(),
            false,
            false,
            null,
            null,
            "스니펫",
            List.of());
    Long envId = messageRepo.insertIgnoreConflict(accountId, folderId, msg).orElseThrow();
    Long contentId =
        dsl.select(EMAIL_MESSAGE.CONTENT_ID)
            .from(EMAIL_MESSAGE)
            .where(EMAIL_MESSAGE.ID.eq(envId))
            .fetchOneInto(Long.class);
    contentRepo.updateBody(contentId, "본문", null, "스니펫");
    return envId;
  }

  @Test
  void updateClassification_categoryToContent_needsReplyToEnvelope() {
    long userId = TestFixtures.createHuman(dsl);
    long accountId = createAccount(userId, "cat-" + System.nanoTime() + "@test.local");
    long folderId = folderRepo.ensureFolder(accountId, "INBOX").id();
    long msgId = insertMessage(accountId, folderId, "cat-1@test.local");

    messageRepo.updateClassification(msgId, "업무", true);

    // category 는 content 에 기록.
    Long contentId =
        dsl.select(EMAIL_MESSAGE.CONTENT_ID)
            .from(EMAIL_MESSAGE)
            .where(EMAIL_MESSAGE.ID.eq(msgId))
            .fetchOneInto(Long.class);
    String catOnContent =
        dsl.select(EMAIL_CONTENT.AI_CATEGORY)
            .from(EMAIL_CONTENT)
            .where(EMAIL_CONTENT.ID.eq(contentId))
            .fetchOneInto(String.class);
    assertThat(catOnContent).as("category 는 content 에 기록").isEqualTo("업무");

    // needs_reply 는 envelope 잔류(#485 술어 소비).
    Boolean needsReplyOnEnvelope =
        dsl.select(EMAIL_MESSAGE.AI_NEEDS_REPLY)
            .from(EMAIL_MESSAGE)
            .where(EMAIL_MESSAGE.ID.eq(msgId))
            .fetchOneInto(Boolean.class);
    assertThat(needsReplyOnEnvelope).as("needs_reply 는 envelope 잔류").isTrue();

    // listByAccount 가 category 를 content 에서 읽어 노출.
    List<EmailMessageSummary> list =
        messageRepo.listByAccount(accountId, "INBOX", null, false, "업무", false, 10);
    assertThat(list).as("category=업무 필터가 content 컬럼으로 동작").hasSize(1);
    assertThat(list.get(0).aiCategory()).isEqualTo("업무");
  }
}
