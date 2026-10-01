package com.workplace.mail.service;

import static com.workplace.jooq.Tables.EMAIL_MESSAGE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.workplace.auth.repository.PersonalAssistantRepository;
import com.workplace.auth.repository.WorkspaceAssistantRepository;
import com.workplace.auth.service.AiAgentCredentialService;
import com.workplace.global.security.EncryptionService;
import com.workplace.mail.MailTestPorts;
import com.workplace.mail.dto.EmailAccountRequest;
import com.workplace.mail.dto.MailSecurity;
import com.workplace.mail.outbound.AiAgentMailClient;
import com.workplace.mail.outbound.MailAiMessages.SummarizeResult;
import com.workplace.mail.repository.EmailAccountRepository;
import com.workplace.mail.repository.EmailContentRepository;
import com.workplace.mail.repository.EmailFolderRepository;
import com.workplace.mail.repository.EmailMessageRepository;
import com.workplace.mail.repository.EmailMessageRepository.AiContext;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.time.Instant;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.transaction.annotation.Transactional;

/**
 * MailAiService 2-티어 요약 통합 테스트.
 *
 * <p>AssistantResolver 는 실제 빈(DB 기반) — 공통/개인 비서를 직접 시드해 T1/T2 분기를 검증한다.
 * mailClient(AiAgentMailClient) 만 Mock — 실제 LLM 호출 없이 고정 응답 반환.
 */
@Transactional
@TestPropertySource(properties = "workplace.ai-agent.enabled=true")
class MailTwoTierSummaryTest extends IntegrationTestBase {

  @Autowired MailAiService service;
  @Autowired DSLContext dsl;
  @Autowired EmailAccountRepository accountRepo;
  @Autowired EmailFolderRepository folderRepo;
  @Autowired EmailMessageRepository messageRepo;
  @Autowired EmailContentRepository contentRepo;
  @Autowired EncryptionService encryption;

  // 비서 시드용 — 실제 resolver 가 이 저장소를 사용한다
  @Autowired WorkspaceAssistantRepository workspaceAssistantRepo;
  @Autowired PersonalAssistantRepository personalAssistantRepo;
  @Autowired AiAgentCredentialService credentialService;

  /** 실 LLM 호출 차단 — 고정 요약 반환 */
  @MockitoBean AiAgentMailClient mailClient;

  /** aiEnabled=true 계정 ID */
  private long accountAiEnabled;

  /** aiEnabled=false 계정 ID */
  private long accountAiDisabled;

  /** accountId → userId 매핑 (ownerOf 구현용) */
  private final Map<Long, Long> accountOwner = new HashMap<>();

  @BeforeEach
  void setUp() {
    long userEnabled = TestFixtures.createHuman(dsl);
    long userDisabled = TestFixtures.createHuman(dsl);
    accountAiEnabled = createAccount(userEnabled, "tier-enabled@test.local", true);
    accountAiDisabled = createAccount(userDisabled, "tier-disabled@test.local", false);
    accountOwner.put(accountAiEnabled, userEnabled);
    accountOwner.put(accountAiDisabled, userDisabled);
    // mailClient 는 항상 고정 요약 반환
    when(mailClient.summarize(any())).thenReturn(new SummarizeResult("• AI요약"));
  }

  /** accountId 소유자 userId 반환. */
  private long ownerOf(long accountId) {
    return accountOwner.get(accountId);
  }

  /** AI 계정 생성 헬퍼 */
  private long createAccount(long userId, String email, boolean aiEnabled) {
    EmailAccountRequest req =
        new EmailAccountRequest(
            email,
            "표시명",
            "127.0.0.1",
            MailTestPorts.IMAP,
            MailSecurity.NONE,
            email,
            "127.0.0.1",
            MailTestPorts.SMTP,
            MailSecurity.NONE,
            email,
            "pw",
            aiEnabled);
    return accountRepo.insert(userId, req, encryption.encrypt("pw"));
  }

  /**
   * 테넌트 공통 비서 + active 토큰 시드.
   *
   * <p>resolveWorkspaceOrEmpty() 가 이 비서를 반환한다.
   */
  private void seedWorkspaceAssistantWithToken() {
    // 공통 비서 소유자로 임의 사람 사용(실제 워크스페이스 비서는 테넌트 단일)
    long admin = TestFixtures.createHuman(dsl);
    long agent = TestFixtures.createAgentWithToken(dsl, credentialService, admin);
    workspaceAssistantRepo.upsert(agent, admin);
  }

  /**
   * 특정 사용자의 개인 비서 + active 토큰 시드.
   *
   * <p>resolvePersonalOrEmpty(userId) 가 이 비서를 반환한다.
   */
  private void seedPersonalAssistantWithToken(long userId) {
    long agent = TestFixtures.createAgentWithToken(dsl, credentialService, userId);
    personalAssistantRepo.setAgentId(userId, agent);
  }

  /**
   * 본문 있는 INBOX 메시지 시드.
   *
   * <p>email_content.body_text 에 본문을 적재해 callSummarize 가 실제로 본문을 읽는지 검증한다.
   */
  private long seedInboxMessageWithBody(long accountId) {
    long folderId = folderRepo.ensureFolder(accountId, "INBOX").id();
    com.workplace.mail.dto.ParsedMessage msg =
        new com.workplace.mail.dto.ParsedMessage(
            System.nanoTime(),
            "tier-msg-" + System.nanoTime() + "@test.local",
            "tier-thread-" + System.nanoTime(),
            null,
            null,
            "sender@example.com",
            null,
            null,
            null,
            "테스트 제목",
            Instant.now(),
            Instant.now(),
            false,
            false,
            null,
            null,
            "스니펫",
            List.of());
    long envId = messageRepo.insertIgnoreConflict(accountId, folderId, msg).orElseThrow();
    Long contentId =
        dsl.select(EMAIL_MESSAGE.CONTENT_ID)
            .from(EMAIL_MESSAGE)
            .where(EMAIL_MESSAGE.ID.eq(envId))
            .fetchOneInto(Long.class);
    contentRepo.updateBody(contentId, "테스트 본문 내용", null, "스니펫");
    TestFixtures.markMailFetched(dsl, envId);
    return envId;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // T1: ensureObjectiveSummary
  // ──────────────────────────────────────────────────────────────────────────

  /** 공통비서 있는 테넌트에서 aiEnabled=false 계정의 메일도 객관적 요약이 채워져야 한다. (T1은 ai_enabled 게이트 없음) */
  @Test
  void ensureObjectiveSummary_summarizes_evenWhenAccountAiDisabled_whenWorkspaceAssistantExists() {
    seedWorkspaceAssistantWithToken();
    long msg = seedInboxMessageWithBody(accountAiDisabled);

    service.ensureObjectiveSummary(ownerOf(accountAiDisabled), msg);

    AiContext ctx =
        messageRepo.findAiContextByIdAndUser(ownerOf(accountAiDisabled), msg).orElseThrow();
    assertThat(ctx.summary()).isNotBlank(); // content 공통요약 기록됨
    assertThat(ctx.personalSummary()).isNull(); // 개인요약는 건드리지 않음
  }

  /** 공통비서 없는 테넌트 → 객관적 요약 skip(content.ai_summary 변화 없음). */
  @Test
  void ensureObjectiveSummary_skips_whenNoWorkspaceAssistant() {
    long msg = seedInboxMessageWithBody(accountAiDisabled);

    service.ensureObjectiveSummary(ownerOf(accountAiDisabled), msg);

    assertThat(
            messageRepo
                .findAiContextByIdAndUser(ownerOf(accountAiDisabled), msg)
                .orElseThrow()
                .summary())
        .isNull();
  }

  /**
   * #484: LLM 빈 응답 → ai_summary 는 NULL(빈 요약 캐싱 금지), ai_summarized_at 만 기록('시도했으나 결과 없음'). 실제
   * summarize→updateSummary DB 경로로 검증하고, 배치 대상에서 빠지며 재호출 시 LLM 을 다시 부르지 않음을 확인한다.
   */
  @Test
  void ensureObjectiveSummary_marksAttemptOnly_whenLlmReturnsBlank() {
    seedWorkspaceAssistantWithToken();
    long msg = seedInboxMessageWithBody(accountAiDisabled);

    // Mock LLM 응답을 공백으로 설정
    when(mailClient.summarize(any())).thenReturn(new SummarizeResult("   "));

    service.ensureObjectiveSummary(ownerOf(accountAiDisabled), msg);

    AiContext ctx =
        messageRepo.findAiContextByIdAndUser(ownerOf(accountAiDisabled), msg).orElseThrow();
    assertThat(ctx.summary()).isNull(); // 빈 요약은 저장하지 않음
    assertThat(ctx.summaryAttempted()).isTrue(); // 시도 시각은 기록
    // 배치 대상(summarized_at IS NULL)에서 제외 — 무한 재시도 차단
    assertThat(messageRepo.listRecentUnreadUnsummarizedIds(accountAiDisabled, 20))
        .doesNotContain(msg);

    // 재호출해도 LLM 을 다시 부르지 않는다
    service.ensureObjectiveSummary(ownerOf(accountAiDisabled), msg);
    verify(mailClient, times(1)).summarize(any());
  }

  /** #484: 정상 응답은 저장되고 배치 대상에서 빠진다(실 DB 경로). */
  @Test
  void ensureObjectiveSummary_persistsSummary_andLeavesBatchTargets() {
    seedWorkspaceAssistantWithToken();
    long msg = seedInboxMessageWithBody(accountAiDisabled);
    assertThat(messageRepo.listRecentUnreadUnsummarizedIds(accountAiDisabled, 20)).contains(msg);

    service.ensureObjectiveSummary(ownerOf(accountAiDisabled), msg);

    AiContext ctx =
        messageRepo.findAiContextByIdAndUser(ownerOf(accountAiDisabled), msg).orElseThrow();
    assertThat(ctx.summary()).isEqualTo("• AI요약");
    assertThat(ctx.summaryAttempted()).isTrue();
    assertThat(messageRepo.listRecentUnreadUnsummarizedIds(accountAiDisabled, 20))
        .doesNotContain(msg);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // T2: ensurePersonalSummary
  // ──────────────────────────────────────────────────────────────────────────

  /** aiEnabled=true + 개인비서 있음 → 개인 요약(email_message.ai_personal_summary)이 채워진다. */
  @Test
  void ensurePersonalSummary_writesEnvelope_whenAiEnabledAndPersonalAssistant() {
    seedPersonalAssistantWithToken(ownerOf(accountAiEnabled));
    long msg = seedInboxMessageWithBody(accountAiEnabled);

    service.ensurePersonalSummary(ownerOf(accountAiEnabled), msg);

    assertThat(
            messageRepo
                .findAiContextByIdAndUser(ownerOf(accountAiEnabled), msg)
                .orElseThrow()
                .personalSummary())
        .isNotBlank();
  }

  /** aiEnabled=true 이지만 개인비서 없음(공통비서만) → 개인요약 skip. (T2는 공통비서로 폴백하지 않는다) */
  @Test
  void ensurePersonalSummary_skips_whenNoPersonalAssistant_evenIfWorkspaceExists() {
    seedWorkspaceAssistantWithToken(); // 공통비서만 존재, 개인비서 없음
    long msg = seedInboxMessageWithBody(accountAiEnabled);

    service.ensurePersonalSummary(ownerOf(accountAiEnabled), msg);

    assertThat(
            messageRepo
                .findAiContextByIdAndUser(ownerOf(accountAiEnabled), msg)
                .orElseThrow()
                .personalSummary())
        .isNull();
  }

  /** #484: 개인 요약도 LLM 빈 응답이면 시도 시각만 기록 → 개인 배치 대상 제외 + 재호출 없음. */
  @Test
  void ensurePersonalSummary_marksAttemptOnly_whenLlmReturnsBlank() {
    seedPersonalAssistantWithToken(ownerOf(accountAiEnabled));
    long msg = seedInboxMessageWithBody(accountAiEnabled);
    when(mailClient.summarize(any())).thenReturn(new SummarizeResult(""));

    service.ensurePersonalSummary(ownerOf(accountAiEnabled), msg);

    AiContext ctx =
        messageRepo.findAiContextByIdAndUser(ownerOf(accountAiEnabled), msg).orElseThrow();
    assertThat(ctx.personalSummary()).isNull();
    assertThat(ctx.personalSummaryAttempted()).isTrue();
    assertThat(messageRepo.listRecentUnreadUnpersonalizedIds(accountAiEnabled, 20))
        .doesNotContain(msg);

    service.ensurePersonalSummary(ownerOf(accountAiEnabled), msg);
    verify(mailClient, times(1)).summarize(any());
  }

  /** #484: 온디맨드(개인 티어) — 빈 응답이면 요약 없음(null) 반환, 재조회 시 LLM 재호출 없음. */
  @Test
  void summarize_onDemand_returnsNoSummary_andDoesNotRecall_whenLlmReturnsBlank() {
    seedPersonalAssistantWithToken(ownerOf(accountAiEnabled));
    long msg = seedInboxMessageWithBody(accountAiEnabled);
    when(mailClient.summarize(any())).thenReturn(new SummarizeResult(" "));

    assertThat(service.summarize(ownerOf(accountAiEnabled), msg).summary()).isNull();
    assertThat(service.summarize(ownerOf(accountAiEnabled), msg).summary()).isNull();

    verify(mailClient, times(1)).summarize(any());
  }

  // ──────────────────────────────────────────────────────────────────────────
  // 온디맨드 summarize — 표시 폴백(개인 ?? 공통)
  // ──────────────────────────────────────────────────────────────────────────

  /** 개인+공통 둘 다 저장돼 있을 때 개인요약을 우선 반환한다. */
  @Test
  void summarize_returnsPersonalOverObjective_whenBothPresent() {
    long msg = seedInboxMessageWithBody(accountAiEnabled);
    messageRepo.updateSummary(msg, "• 공통");
    messageRepo.updatePersonalSummary(msg, "• 개인");

    assertThat(service.summarize(ownerOf(accountAiEnabled), msg).summary()).isEqualTo("• 개인");
  }
}
