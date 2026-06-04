package com.workplace.mail;

import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.global.security.EncryptionService;
import com.workplace.mail.dto.EmailAccountRequest;
import com.workplace.mail.dto.MailSecurity;
import com.workplace.mail.outbound.MailAiMessages;
import com.workplace.mail.repository.EmailAccountRepository;
import com.workplace.mail.repository.EmailFolderRepository;
import com.workplace.mail.repository.EmailMessageRepository;
import com.workplace.mail.repository.EmailMessageRepository.AiContext;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/**
 * updateClassification / updateSummary / findAiContextByIdAndUser / findThreadByIdAndUser 통합 테스트.
 * 공유 test DB 환경 — 테스트별 트랜잭션 롤백으로 격리.
 */
@Transactional
class EmailMessageAiRepositoryTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired EmailAccountRepository accountRepo;
  @Autowired EmailFolderRepository folderRepo;
  @Autowired EmailMessageRepository messageRepo;
  @Autowired EncryptionService encryption;

  /** AI 활성화된 계정 생성 헬퍼. */
  private long createAccount(long userId, String email, boolean aiEnabled) {
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
            aiEnabled);
    return accountRepo.insert(userId, req, encryption.encrypt("pw"));
  }

  /**
   * 테스트용 메시지를 INBOX 폴더에 삽입하고 생성된 id 반환. ParsedMessage 는 insertIgnoreConflict 이 사용하므로 직접 jOOQ 로 삽입.
   */
  private long insertMessage(
      long accountId, long folderId, String messageId, String threadId, String bodyText) {
    return dsl.insertInto(
            com.workplace.jooq.tables.EmailMessage.EMAIL_MESSAGE,
            com.workplace.jooq.tables.EmailMessage.EMAIL_MESSAGE.ACCOUNT_ID,
            com.workplace.jooq.tables.EmailMessage.EMAIL_MESSAGE.FOLDER_ID,
            com.workplace.jooq.tables.EmailMessage.EMAIL_MESSAGE.MESSAGE_ID,
            com.workplace.jooq.tables.EmailMessage.EMAIL_MESSAGE.THREAD_ID,
            com.workplace.jooq.tables.EmailMessage.EMAIL_MESSAGE.FROM_ADDRESS,
            com.workplace.jooq.tables.EmailMessage.EMAIL_MESSAGE.SUBJECT,
            com.workplace.jooq.tables.EmailMessage.EMAIL_MESSAGE.BODY_TEXT,
            com.workplace.jooq.tables.EmailMessage.EMAIL_MESSAGE.SNIPPET,
            com.workplace.jooq.tables.EmailMessage.EMAIL_MESSAGE.SEEN,
            com.workplace.jooq.tables.EmailMessage.EMAIL_MESSAGE.HAS_ATTACHMENT,
            com.workplace.jooq.tables.EmailMessage.EMAIL_MESSAGE.RECEIVED_AT)
        .values(
            accountId,
            folderId,
            messageId,
            threadId,
            "sender@example.com",
            "테스트 제목",
            bodyText,
            "스니펫",
            false,
            false,
            java.time.OffsetDateTime.ofInstant(Instant.now(), java.time.ZoneOffset.UTC))
        .returning(com.workplace.jooq.tables.EmailMessage.EMAIL_MESSAGE.ID)
        .fetchOne()
        .get(com.workplace.jooq.tables.EmailMessage.EMAIL_MESSAGE.ID);
  }

  /** updateClassification → findAiContextByIdAndUser 왕복 검증. */
  @Test
  void updateClassification_and_findAiContext_roundTrip() {
    long userId = TestFixtures.createHuman(dsl);
    long accountId = createAccount(userId, "ai-user@test.local", true);
    long folderId = folderRepo.ensureFolder(accountId, "INBOX").id();
    long msgId = insertMessage(accountId, folderId, "msg-1@test.local", "thread-1", "본문 내용");

    // 분류 저장
    messageRepo.updateClassification(msgId, "업무", true);

    // AiContext 조회 — 소유 검증(userId) + aiEnabled 반영
    Optional<AiContext> ctx = messageRepo.findAiContextByIdAndUser(userId, msgId);
    assertThat(ctx).isPresent();
    assertThat(ctx.get().aiEnabled()).isTrue();
    assertThat(ctx.get().selfAddress()).isEqualTo("ai-user@test.local");
    assertThat(ctx.get().subject()).isEqualTo("테스트 제목");
    assertThat(ctx.get().bodyText()).isEqualTo("본문 내용");
    assertThat(ctx.get().summary()).isNull(); // 아직 요약 없음
  }

  /** updateSummary 후 findAiContextByIdAndUser 에 summary 가 반영된다. */
  @Test
  void updateSummary_reflectedInAiContext() {
    long userId = TestFixtures.createHuman(dsl);
    long accountId = createAccount(userId, "summary-user@test.local", false);
    long folderId = folderRepo.ensureFolder(accountId, "INBOX").id();
    long msgId = insertMessage(accountId, folderId, "msg-2@test.local", "thread-2", "긴 본문");

    messageRepo.updateSummary(msgId, "요약된 내용");

    Optional<AiContext> ctx = messageRepo.findAiContextByIdAndUser(userId, msgId);
    assertThat(ctx).isPresent();
    assertThat(ctx.get().summary()).isEqualTo("요약된 내용");
    assertThat(ctx.get().aiEnabled()).isFalse(); // aiEnabled=false 계정
  }

  /** 다른 사용자의 메시지는 findAiContextByIdAndUser 에서 empty 반환. */
  @Test
  void findAiContext_otherUser_returnsEmpty() {
    long owner = TestFixtures.createHuman(dsl);
    long other = TestFixtures.createHuman(dsl);
    long accountId = createAccount(owner, "owner@test.local", true);
    long folderId = folderRepo.ensureFolder(accountId, "INBOX").id();
    long msgId = insertMessage(accountId, folderId, "msg-3@test.local", "thread-3", "본문");

    assertThat(messageRepo.findAiContextByIdAndUser(other, msgId)).isEmpty();
  }

  /** findThreadByIdAndUser — 동일 thread_id 메시지 2건을 시간순으로 반환. */
  @Test
  void findThread_returnsTwoMessagesInOrder() {
    long userId = TestFixtures.createHuman(dsl);
    long accountId = createAccount(userId, "thread-user@test.local", true);
    long folderId = folderRepo.ensureFolder(accountId, "INBOX").id();

    // 같은 thread, 시간이 다른 2개 메시지
    long firstId = insertMessage(accountId, folderId, "first@test.local", "t-abc", "첫 번째 본문");
    long secondId = insertMessage(accountId, folderId, "second@test.local", "t-abc", "두 번째 본문");

    List<MailAiMessages.ThreadMessage> thread = messageRepo.findThreadByIdAndUser(userId, secondId);

    assertThat(thread).hasSize(2);
    // RECEIVED_AT asc 정렬이므로 first 가 앞에 와야 함(같을 경우 id asc 로 보장)
    assertThat(thread.get(0).body()).isEqualTo("첫 번째 본문");
    assertThat(thread.get(1).body()).isEqualTo("두 번째 본문");
  }

  /** 다른 사용자의 메시지로 findThreadByIdAndUser 를 호출하면 빈 리스트 반환. */
  @Test
  void findThread_otherUser_returnsEmpty() {
    long owner = TestFixtures.createHuman(dsl);
    long other = TestFixtures.createHuman(dsl);
    long accountId = createAccount(owner, "owner2@test.local", true);
    long folderId = folderRepo.ensureFolder(accountId, "INBOX").id();
    long msgId = insertMessage(accountId, folderId, "msg-4@test.local", "thread-4", "본문");

    assertThat(messageRepo.findThreadByIdAndUser(other, msgId)).isEmpty();
  }
}
