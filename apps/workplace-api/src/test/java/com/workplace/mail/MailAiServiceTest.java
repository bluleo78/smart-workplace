package com.workplace.mail;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.workplace.auth.service.AssistantResolver;
import com.workplace.auth.service.AssistantSpec;
import com.workplace.global.security.EncryptionService;
import com.workplace.mail.dto.EmailAccountRequest;
import com.workplace.mail.dto.MailSecurity;
import com.workplace.mail.dto.MailSummary;
import com.workplace.mail.exception.MailAiUnavailableException;
import com.workplace.mail.outbound.AiAgentMailClient;
import com.workplace.mail.outbound.MailAiMessages.SummarizeResult;
import com.workplace.mail.repository.EmailAccountRepository;
import com.workplace.mail.repository.EmailFolderRepository;
import com.workplace.mail.repository.EmailMessageRepository;
import com.workplace.mail.service.MailAiService;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.time.Instant;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.transaction.annotation.Transactional;

/** MailAiService 통합 테스트. ai-agent 클라이언트와 비서 해석기는 Mock으로 대체 — 서비스 로직(캐시, gate)만 검증. */
@Transactional
@TestPropertySource(properties = "workplace.ai-agent.enabled=true")
class MailAiServiceTest extends IntegrationTestBase {

  @Autowired MailAiService mailAiService;
  @Autowired DSLContext dsl;
  @Autowired EmailAccountRepository accountRepo;
  @Autowired EmailFolderRepository folderRepo;
  @Autowired EmailMessageRepository messageRepo;
  @Autowired EncryptionService encryption;

  /** ai-agent 실호출 차단 — 더미 응답으로 고정. */
  @MockitoBean AiAgentMailClient mailClient;

  /** 비서 해석은 관심 밖 — 더미 사양으로 고정. */
  @MockitoBean AssistantResolver assistantResolver;

  private void stubAssistant() {
    when(assistantResolver.resolve(anyLong()))
        .thenReturn(new AssistantSpec(5L, "claude-sonnet-4-6", "NORMAL", 8, 60000));
  }

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

  /** 테스트용 메시지를 INBOX 폴더에 삽입하고 생성된 id 반환. */
  private long insertMessage(long accountId, long folderId, String msgId, String threadId) {
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
            msgId,
            threadId,
            "sender@example.com",
            "테스트 제목",
            "본문 내용 입니다",
            "스니펫",
            false,
            false,
            java.time.OffsetDateTime.ofInstant(Instant.now(), java.time.ZoneOffset.UTC))
        .returning(com.workplace.jooq.tables.EmailMessage.EMAIL_MESSAGE.ID)
        .fetchOne()
        .get(com.workplace.jooq.tables.EmailMessage.EMAIL_MESSAGE.ID);
  }

  /** 캐시 miss 시 ai-agent 호출 후 저장, 두 번째 호출은 캐시 hit → 재호출 없음. */
  @Test
  void summarize_캐시miss_호출저장_두번째hit_재호출없음() {
    long userId = TestFixtures.createHuman(dsl);
    long accountId = createAccount(userId, "ai-svc@test.local", true);
    long folderId = folderRepo.ensureFolder(accountId, "INBOX").id();
    long msgId = insertMessage(accountId, folderId, "svc-msg-1@test.local", "svc-thread-1");

    stubAssistant();
    when(mailClient.summarize(any())).thenReturn(new SummarizeResult("• 캐시될요약"));

    // 첫 번째 호출 — 캐시 miss, ai-agent 호출
    MailSummary first = mailAiService.summarize(userId, msgId);
    assertThat(first.summary()).isEqualTo("• 캐시될요약");

    // 두 번째 호출 — 캐시 hit, 재호출 없음
    MailSummary second = mailAiService.summarize(userId, msgId);
    assertThat(second.summary()).isEqualTo("• 캐시될요약");

    verify(mailClient, times(1)).summarize(any());
  }

  /** ai_enabled=false 계정은 요약 호출 전에 503(MailAiUnavailableException) 으로 단락된다. */
  @Test
  void summarize_aiEnabled_false_요약차단() {
    long userId = TestFixtures.createHuman(dsl);
    long accountId = createAccount(userId, "no-ai@test.local", false);
    long folderId = folderRepo.ensureFolder(accountId, "INBOX").id();
    long msgId = insertMessage(accountId, folderId, "svc-msg-2@test.local", "svc-thread-2");

    assertThatThrownBy(() -> mailAiService.summarize(userId, msgId))
        .isInstanceOf(MailAiUnavailableException.class);

    verify(mailClient, never()).summarize(any());
  }
}
