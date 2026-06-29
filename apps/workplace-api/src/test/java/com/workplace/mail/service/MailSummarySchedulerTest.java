package com.workplace.mail.service;

import static com.workplace.jooq.Tables.AI_AGENT_CREDENTIAL;
import static com.workplace.jooq.Tables.AUDIT_LOG;
import static com.workplace.jooq.Tables.EMAIL_ACCOUNT;
import static com.workplace.jooq.Tables.EMAIL_MESSAGE;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;

import com.workplace.auth.repository.PersonalAssistantRepository;
import com.workplace.auth.repository.WorkspaceAssistantRepository;
import com.workplace.auth.service.AiAgentCredentialService;
import com.workplace.global.security.EncryptionService;
import com.workplace.global.tenant.TenantContext;
import com.workplace.mail.dto.EmailAccountRequest;
import com.workplace.mail.dto.MailSecurity;
import com.workplace.mail.dto.ParsedMessage;
import com.workplace.mail.outbound.AiAgentMailClient;
import com.workplace.mail.outbound.MailAiMessages.SummarizeResult;
import com.workplace.mail.repository.EmailAccountRepository;
import com.workplace.mail.repository.EmailContentRepository;
import com.workplace.mail.repository.EmailFolderRepository;
import com.workplace.mail.repository.EmailMessageRepository;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

/**
 * Task 6: 스케줄러 두 패스(T1 객관적·T2 개인) 통합 테스트.
 *
 * <p>backfill 은 실제 빈 사용 — mailClient(LLM I/O)만 Mock. 공통/개인 비서를 직접 시드해 T1/T2 분기를 실제 DB 에 기록하는지
 * 확인한다.
 *
 * <p>비-@Transactional: 스케줄러 내부 트랜잭션(TenantScopedRunner·TransactionTemplate)이 분리 커밋해야 RLS GUC 가
 * 올바르게 주입된다. 시드 데이터는 auto-commit → 스케줄러가 별도 커넥션에서 읽을 수 있다.
 *
 * <p>테스트 풀 커넥션은 connection-init-sql 로 세션 GUC=1 이 기본 설정돼 있어 tenant 1 작업에 별도 GUC 세팅 불필요.
 */
@TestPropertySource(properties = "workplace.ai-agent.enabled=true")
@DisplayName("스케줄러 T1 객관적·T2 개인 두 패스 통합")
class MailSummarySchedulerTest extends IntegrationTestBase {

  @Autowired MailSummaryScheduler scheduler;
  @Autowired DSLContext dsl;
  @Autowired EmailAccountRepository accountRepo;
  @Autowired EmailFolderRepository folderRepo;
  @Autowired EmailMessageRepository messageRepo;
  @Autowired EmailContentRepository contentRepo;
  @Autowired EncryptionService encryption;
  @Autowired WorkspaceAssistantRepository workspaceAssistantRepo;
  @Autowired PersonalAssistantRepository personalAssistantRepo;
  @Autowired AiAgentCredentialService credentialService;

  /** 실제 LLM 호출 차단 — 고정 요약 반환. */
  @MockitoBean AiAgentMailClient mailClient;

  /** 기본 테스트 테넌트. 풀 GUC=1 이 기본값이라 별도 set 불필요. */
  private final long tenantId = 1L;

  /** aiEnabled=true 계정 ID */
  private long accountAiEnabled;

  /** aiEnabled=false 계정 ID */
  private long accountAiDisabled;

  /** accountId → userId 매핑. */
  private final Map<Long, Long> accountOwner = new HashMap<>();

  /** 정리 대상 계정 ID 목록. */
  private final List<Long> accountsToDelete = new ArrayList<>();

  /** 정리 대상 사용자 ID 목록(비서 agent 포함). */
  private final List<Long> usersToDelete = new ArrayList<>();

  /** 공통 비서 agent ID (seedWorkspaceAssistantWithToken 이 채움). */
  private Long wsAgentId;

  @BeforeEach
  void setUp() {
    // 두 사용자(AI ON/OFF) + 각각의 메일 계정 생성 — 세션 GUC=1 이므로 tenant#1 자동.
    long userEnabled = TestFixtures.createHuman(dsl);
    long userDisabled = TestFixtures.createHuman(dsl);
    accountAiEnabled = createAccount(userEnabled, "sched2-on-" + System.nanoTime() + "@t.local", true);
    accountAiDisabled = createAccount(userDisabled, "sched2-off-" + System.nanoTime() + "@t.local", false);
    accountOwner.put(accountAiEnabled, userEnabled);
    accountOwner.put(accountAiDisabled, userDisabled);
    usersToDelete.add(userEnabled);
    usersToDelete.add(userDisabled);
    accountsToDelete.add(accountAiEnabled);
    accountsToDelete.add(accountAiDisabled);
    // LLM 은 항상 고정 요약 반환
    when(mailClient.summarize(any())).thenReturn(new SummarizeResult("• 스케줄러 요약"));
  }

  @AfterEach
  void cleanup() {
    // 비서 정리 (RLS-안전: cleanupInTenant 가 transaction-local GUC 주입)
    cleanupInTenant(
        tenantId,
        () -> {
          workspaceAssistantRepo.deleteAssistant();
          // 개인비서는 user 행 삭제로 자동 정리(FK)
        });
    // 계정 → 사용자(비서 agent 포함) 정리
    cleanupInTenant(
        tenantId,
        () -> {
          for (long id : accountsToDelete) {
            dsl.deleteFrom(EMAIL_ACCOUNT).where(EMAIL_ACCOUNT.ID.eq(id)).execute();
          }
        });
    cleanupInTenant(
        tenantId,
        () -> {
          // 사용자 삭제 전 FK 의존 테이블을 순서대로 정리.
          // ai_agent_credential: user_id(agent) + created_by(admin) 양방향 FK.
          for (long id : usersToDelete) {
            dsl.deleteFrom(AI_AGENT_CREDENTIAL)
                .where(
                    AI_AGENT_CREDENTIAL.USER_ID.eq(id).or(AI_AGENT_CREDENTIAL.CREATED_BY.eq(id)))
                .execute();
          }
          // audit_log.user_id FK.
          for (long id : usersToDelete) {
            dsl.deleteFrom(AUDIT_LOG).where(AUDIT_LOG.USER_ID.eq(id)).execute();
          }
          // personal_assistant_agent_id FK — 에이전트 삭제 전에 참조 해제.
          for (long id : usersToDelete) {
            dsl.update(USER)
                .setNull(USER.PERSONAL_ASSISTANT_AGENT_ID)
                .where(USER.PERSONAL_ASSISTANT_AGENT_ID.eq(id))
                .execute();
          }
          for (long id : usersToDelete) {
            dsl.deleteFrom(USER).where(USER.ID.eq(id)).execute();
          }
        });
    TenantContext.clear();
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Helper methods
  // ──────────────────────────────────────────────────────────────────────────

  /** accountId 소유자 userId 반환. */
  private long ownerOf(long accountId) {
    return accountOwner.get(accountId);
  }

  /** 지정 테넌트 컨텍스트에서 runnable 실행. 어서션 목적. */
  private void runInTenant(long tid, Runnable r) {
    TenantContext.set(tid);
    try {
      r.run();
    } finally {
      TenantContext.clear();
    }
  }

  /**
   * 현재 테넌트(세션 GUC=1)에 공통 비서 + active 토큰 시드.
   *
   * <p>resolveWorkspaceOrEmpty() 가 이 비서를 반환해 T1 패스가 활성화된다.
   */
  private void seedWorkspaceAssistantWithToken(long tid) {
    // tid=1 → 세션 GUC 기본값=1 이라 별도 GUC 조작 불필요.
    // credentialService.register() 는 @Transactional — TenantContext 주입으로 GUC=tid 설정.
    TenantContext.set(tid);
    try {
      long admin = TestFixtures.createHuman(dsl);
      wsAgentId = TestFixtures.createAgentWithToken(dsl, credentialService, admin);
      workspaceAssistantRepo.upsert(wsAgentId, admin);
      usersToDelete.add(admin);
      usersToDelete.add(wsAgentId);
    } finally {
      TenantContext.clear();
    }
  }

  /**
   * 지정 사용자에 개인 비서 + active 토큰 시드.
   *
   * <p>resolvePersonalOrEmpty(userId) 가 이 비서를 반환해 T2 패스가 활성화된다.
   */
  private void seedPersonalAssistantWithToken(long userId) {
    TenantContext.set(tenantId);
    try {
      long agent = TestFixtures.createAgentWithToken(dsl, credentialService, userId);
      personalAssistantRepo.setAgentId(userId, agent);
      usersToDelete.add(agent);
    } finally {
      TenantContext.clear();
    }
  }

  /**
   * 본문 있는 INBOX 메시지 시드. email_content.body_text 에 본문을 적재해 요약 대상이 된다.
   *
   * @param accountId 메시지를 적재할 계정 ID
   * @return 생성된 envelope ID (email_message.id)
   */
  private long seedInboxMessageWithBody(long accountId) {
    long folderId = folderRepo.ensureFolder(accountId, "INBOX").id();
    ParsedMessage msg =
        new ParsedMessage(
            System.nanoTime(),
            "sched2-msg-" + System.nanoTime() + "@t.local",
            "sched2-thread-" + System.nanoTime(),
            null,
            null,
            "sender@example.com",
            null,
            null,
            null,
            "스케줄러 테스트 제목",
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
    contentRepo.updateBody(contentId, "스케줄러 테스트 본문 내용", null, "스니펫");
    return envId;
  }

  /** AI 계정 생성 헬퍼 — 세션 GUC=1 이라 tenant#1 에 생성됨. */
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

  // ──────────────────────────────────────────────────────────────────────────
  // 신규 테스트: Task 6 두 패스 검증
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * T1 객관적 패스 — 공통 비서가 있는 테넌트에서 ai_enabled=false 계정의 안읽은 메일도 content 요약이 채워진다.
   *
   * <p>T1은 aiEnabled 무관: 테넌트에 공통 비서가 있으면 findActiveForSync() 전체 계정 대상.
   */
  @Test
  @DisplayName("T1: 공통비서 있는 테넌트 → aiEnabled=false 계정도 content 요약 기록")
  void runOnce_objectivePass_summarizesAllAccounts_inWorkspaceAssistantTenant() {
    // 공통비서 없는 테넌트에선 T1 skip — 먼저 비서 시드.
    TenantContext.clear(); // ambient GUC 마스킹 방지
    seedWorkspaceAssistantWithToken(tenantId);
    long msg = seedInboxMessageWithBody(accountAiDisabled);
    scheduler.runOnce();
    runInTenant(
        tenantId,
        () ->
            assertThat(
                    messageRepo
                        .findAiContextByIdAndUser(ownerOf(accountAiDisabled), msg)
                        .orElseThrow()
                        .summary())
                .isNotBlank());
  }

  /**
   * T2 개인 패스 — ai_enabled=true 계정만 개인 요약(ai_personal_summary)이 채워진다. ai_enabled=false 계정은 T2 대상이
   * 아니므로 개인 요약이 null 로 유지된다.
   */
  @Test
  @DisplayName("T2: 개인비서 있는 aiEnabled 계정만 개인 요약 기록 — disabled 계정은 null 유지")
  void runOnce_personalPass_onlyAiEnabledAccounts() {
    TenantContext.clear();
    seedPersonalAssistantWithToken(ownerOf(accountAiEnabled));
    long enabled = seedInboxMessageWithBody(accountAiEnabled);
    long disabled = seedInboxMessageWithBody(accountAiDisabled);
    scheduler.runOnce();
    runInTenant(
        tenantId,
        () -> {
          assertThat(
                  messageRepo
                      .findAiContextByIdAndUser(ownerOf(accountAiEnabled), enabled)
                      .orElseThrow()
                      .personalSummary())
              .isNotBlank();
          assertThat(
                  messageRepo
                      .findAiContextByIdAndUser(ownerOf(accountAiDisabled), disabled)
                      .orElseThrow()
                      .personalSummary())
              .isNull();
        });
  }
}
