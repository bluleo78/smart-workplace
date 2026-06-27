package com.workplace.mail;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;

import com.workplace.auth.service.AssistantResolver;
import com.workplace.auth.service.AssistantSpec;
import com.workplace.global.security.EncryptionService;
import com.workplace.mail.outbound.AiAgentMailClient;
import com.workplace.mail.outbound.MailAiMessages.ClassifyResult;
import com.workplace.mail.repository.EmailAccountRepository;
import com.workplace.mail.repository.EmailFolderRepository;
import com.workplace.mail.repository.EmailMessageRepository;
import com.workplace.mail.service.MailClassifyBackfillService;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.time.Instant;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.transaction.annotation.Transactional;

/**
 * MailClassifyBackfillService 통합 테스트. 비동기 진입점이 아닌 동기 본체 {@link
 * MailClassifyBackfillService#classifyRecentUnreadNow} 를 직접 호출해 같은 스레드에서 결과를 단언한다.
 * AiAgentMailClient 는 @MockitoBean 으로 실호출 차단, 결정적 응답 반환.
 */
@Transactional
@TestPropertySource(properties = "workplace.ai-agent.enabled=true")
class MailClassifyBackfillServiceTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired MailClassifyBackfillService classifyBackfillService;
  @Autowired EmailAccountRepository accountRepo;
  @Autowired EmailFolderRepository folderRepo;
  @Autowired EmailMessageRepository messageRepo;
  @Autowired EncryptionService encryption;

  /** ai-agent 실호출 차단 — 결정적 응답(needsReply=true)으로 고정. */
  @MockitoBean AiAgentMailClient mailClient;

  /** 비서 해석 — 더미 사양으로 고정(MailAiServiceTest 패턴 미러). */
  @MockitoBean AssistantResolver assistantResolver;

  private void stubAssistant(long userId) {
    when(assistantResolver.resolve(userId))
        .thenReturn(new AssistantSpec(5L, "claude-sonnet-4-6", "NORMAL", 8, 60000));
  }

  /**
   * 분류가 필요한 안읽음·미분류 메시지가 classifyRecentUnreadNow 후 aiNeedsReply 가 채워지는지 검증. mailClient.classify 는
   * needsReply=true 를 반환하도록 stub.
   */
  @Test
  void classifyRecentUnreadNow_classifies_unread_unclassified() {
    long userId = TestFixtures.createHuman(dsl);
    long accountId = MailTestSupport.insertAccount(accountRepo, encryption, userId, true);
    long folderId = folderRepo.ensureFolder(accountId, "INBOX").id();
    long msgId = insertMessage(accountId, folderId);

    stubAssistant(userId);
    // classify stub: needsReply=true 반환
    when(mailClient.classify(any())).thenReturn(new ClassifyResult("업무", true));

    // 동기 본체 직접 호출
    classifyBackfillService.classifyRecentUnreadNow(userId, accountId);

    // aiNeedsReply 가 null → true 로 채워졌는지 listRecentUnread 를 통해 확인
    // (분류완료 시 listRecentUnreadUnclassifiedIds 에서 제외 → 빈 목록이 됨)
    var remaining = messageRepo.listRecentUnreadUnclassifiedIds(accountId, 10);
    assertThat(remaining).doesNotContain(msgId);

    // 명시적 확인: listByAccount 로 aiNeedsReply 값 검증
    var summaries = messageRepo.listByAccount(accountId, "INBOX", null, 10);
    var msg = summaries.stream().filter(s -> s.id() == msgId).findFirst();
    assertThat(msg).isPresent();
    assertThat(msg.get().aiNeedsReply()).isTrue();
  }

  /** 비서 미설정(resolveSpecOrNull=null) 시 분류를 건너뛰어 aiNeedsReply 가 null 로 유지된다. */
  @Test
  void classifyRecentUnreadNow_noSpec_skips() {
    long userId = TestFixtures.createHuman(dsl);
    long accountId = MailTestSupport.insertAccount(accountRepo, encryption, userId, true);
    long folderId = folderRepo.ensureFolder(accountId, "INBOX").id();
    long msgId = insertMessage(accountId, folderId);

    // 비서 미설정 시뮬레이션 — resolve 가 예외를 던지면 resolveSpecOrNull 이 null 을 반환한다
    when(assistantResolver.resolve(userId)).thenThrow(new RuntimeException("비서 없음"));

    classifyBackfillService.classifyRecentUnreadNow(userId, accountId);

    // aiNeedsReply 가 여전히 null → 미분류 목록에 포함
    var remaining = messageRepo.listRecentUnreadUnclassifiedIds(accountId, 10);
    assertThat(remaining).contains(msgId);
  }

  /** 테스트용 안읽음·미분류 메시지를 INBOX 에 직접 삽입하고 id 를 반환. aiNeedsReply 는 null(미분류 상태)로 둔다. */
  private long insertMessage(long accountId, long folderId) {
    return dsl.insertInto(
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
            "msg-backfill-" + System.nanoTime() + "@test.local",
            "thread-backfill-" + System.nanoTime(),
            "sender@example.com",
            // subject/snippet 값 제거
            false, // seen=false (안읽음)
            false,
            java.time.OffsetDateTime.ofInstant(Instant.now(), java.time.ZoneOffset.UTC))
        .returning(com.workplace.jooq.tables.EmailMessage.EMAIL_MESSAGE.ID)
        .fetchOne()
        .get(com.workplace.jooq.tables.EmailMessage.EMAIL_MESSAGE.ID);
  }
}
