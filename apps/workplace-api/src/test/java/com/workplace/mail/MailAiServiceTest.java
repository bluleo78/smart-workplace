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
import com.workplace.mail.dto.MailDraftCoaching;
import com.workplace.mail.dto.MailDraftCoachingRequest;
import com.workplace.mail.dto.MailSecurity;
import com.workplace.mail.dto.MailSummary;
import com.workplace.mail.dto.MailSummaryStatus;
import com.workplace.mail.dto.ParsedMessage;
import com.workplace.mail.exception.EmailAccountNotFoundException;
import com.workplace.mail.exception.MailAiUnavailableException;
import com.workplace.mail.outbound.AiAgentMailClient;
import com.workplace.mail.outbound.MailAiMessages.AnalyzeContentRequest;
import com.workplace.mail.outbound.MailAiMessages.AnalyzeContentResult;
import com.workplace.mail.outbound.MailAiMessages.AnalyzePersonalResult;
import com.workplace.mail.outbound.MailAiMessages.CoachingNoteWire;
import com.workplace.mail.outbound.MailAiMessages.DraftCoachingRequest;
import com.workplace.mail.outbound.MailAiMessages.DraftCoachingResult;
import com.workplace.mail.repository.EmailAccountRepository;
import com.workplace.mail.repository.EmailContentRepository;
import com.workplace.mail.repository.EmailFolderRepository;
import com.workplace.mail.repository.EmailMessageRepository;
import com.workplace.mail.service.MailAiService;
import com.workplace.mail.service.MailAnalysisFixtures;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
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
  @Autowired EmailContentRepository contentRepo;
  @Autowired EncryptionService encryption;

  /** ai-agent 실호출 차단 — 더미 응답으로 고정. */
  @MockitoBean AiAgentMailClient mailClient;

  /** 비서 해석은 관심 밖 — 더미 사양으로 고정. */
  @MockitoBean AssistantResolver assistantResolver;

  private void stubAssistant() {
    AssistantSpec spec = new AssistantSpec(5L, "claude-sonnet-4-6", "NORMAL", 8, 60000);
    // coachDraft / replyDraft 는 requireSpec → resolve 경로 사용
    when(assistantResolver.resolve(anyLong())).thenReturn(spec);
    // summarize 는 resolveWorkspaceOrEmpty / resolvePersonalOrEmpty 경로 사용(2-tier)
    when(assistantResolver.resolveWorkspaceOrEmpty()).thenReturn(Optional.of(spec));
    when(assistantResolver.resolvePersonalOrEmpty(anyLong())).thenReturn(Optional.empty());
    when(assistantResolver.resolveOrEmpty(anyLong())).thenReturn(Optional.of(spec));
  }

  /** AI 활성화된 계정 생성 헬퍼. */
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
   * 테스트용 메시지를 INBOX 폴더에 삽입하고 생성된 envelope id 반환.
   *
   * <p>Task9 이후 email_message 에는 subject/body/snippet 컬럼이 없다 — ParsedMessage + insertIgnoreConflict
   * 경로로 email_content 행을 생성하고 content_id 를 연결한다. 이를 통해 MailAiService 가 email_content JOIN 에서
   * subject/body 를 실제로 읽는지 검증할 수 있다.
   */
  private long insertMessage(long accountId, long folderId, String msgId, String threadId) {
    ParsedMessage msg =
        new ParsedMessage(
            System.nanoTime(),
            msgId,
            threadId,
            null,
            null,
            "sender@example.com",
            null,
            null,
            null,
            "테스트 제목", // subject → email_content 에 저장
            Instant.now(),
            Instant.now(),
            false,
            false,
            null,
            null,
            "스니펫",
            List.of());
    long envId = messageRepo.insertIgnoreConflict(accountId, folderId, msg).orElseThrow();
    // content_id 를 통해 본문 적재 — 서비스가 JOIN 으로 읽음을 보장
    Long contentId =
        dsl.select(com.workplace.jooq.tables.EmailMessage.EMAIL_MESSAGE.CONTENT_ID)
            .from(com.workplace.jooq.tables.EmailMessage.EMAIL_MESSAGE)
            .where(com.workplace.jooq.tables.EmailMessage.EMAIL_MESSAGE.ID.eq(envId))
            .fetchOneInto(Long.class);
    contentRepo.updateBody(contentId, "테스트 본문", null, "스니펫");
    TestFixtures.markMailFetched(dsl, envId);
    return envId;
  }

  /** 본문을 지정해 INBOX 메시지 삽입(기존 insertMessage 와 같은 경로). */
  private long insertMessage(
      long accountId, long folderId, String msgId, String threadId, String body) {
    long envId = insertMessage(accountId, folderId, msgId, threadId);
    Long contentId =
        dsl.select(com.workplace.jooq.tables.EmailMessage.EMAIL_MESSAGE.CONTENT_ID)
            .from(com.workplace.jooq.tables.EmailMessage.EMAIL_MESSAGE)
            .where(com.workplace.jooq.tables.EmailMessage.EMAIL_MESSAGE.ID.eq(envId))
            .fetchOneInto(Long.class);
    contentRepo.updateBody(contentId, body, null, "스니펫");
    return envId;
  }

  private Long contentIdOf(long envId) {
    return dsl.select(com.workplace.jooq.tables.EmailMessage.EMAIL_MESSAGE.CONTENT_ID)
        .from(com.workplace.jooq.tables.EmailMessage.EMAIL_MESSAGE)
        .where(com.workplace.jooq.tables.EmailMessage.EMAIL_MESSAGE.ID.eq(envId))
        .fetchOneInto(Long.class);
  }

  /** 공통 티어: 미분석이면 ③ 을 즉시 실행해 READY, 두 번째는 캐시 — LLM 1회. */
  @Test
  void summarize_commonTier_generatesOnce_thenCached() {
    long userId = TestFixtures.createHuman(dsl);
    long accountId = createAccount(userId, "ai-svc@test.local", false);
    long folderId = folderRepo.ensureFolder(accountId, "INBOX").id();
    long msgId =
        insertMessage(
            accountId,
            folderId,
            "svc-msg-1@test.local",
            "svc-thread-1",
            MailAnalysisFixtures.LONG_BODY);
    stubAssistant();
    when(mailClient.analyzeContent(any())).thenReturn(new AnalyzeContentResult("업무", "• 캐시될요약"));

    MailSummary first = mailAiService.summarize(userId, msgId);
    MailSummary second = mailAiService.summarize(userId, msgId);

    assertThat(first).isEqualTo(MailSummary.ready("• 캐시될요약"));
    assertThat(second).isEqualTo(MailSummary.ready("• 캐시될요약"));
    verify(mailClient, times(1)).analyzeContent(any());
  }

  /** #484: LLM 빈 응답 → EMPTY, 재조회 시 재호출 없음. */
  @Test
  void summarize_llmBlank_emptyAndNoRetry() {
    long userId = TestFixtures.createHuman(dsl);
    long accountId = createAccount(userId, "ai-svc-blank@test.local", false);
    long folderId = folderRepo.ensureFolder(accountId, "INBOX").id();
    long msgId =
        insertMessage(
            accountId,
            folderId,
            "svc-blank-1@test.local",
            "svc-blank-t1",
            MailAnalysisFixtures.LONG_BODY);
    stubAssistant();
    when(mailClient.analyzeContent(any())).thenReturn(new AnalyzeContentResult("업무", " \n\t "));

    assertThat(mailAiService.summarize(userId, msgId)).isEqualTo(MailSummary.empty());
    assertThat(mailAiService.summarize(userId, msgId)).isEqualTo(MailSummary.empty());
    verify(mailClient, times(1)).analyzeContent(any());
  }

  /** ai_enabled=false + 공통 비서 없음 → 503(시도조차 못함 — 기존 계약). */
  @Test
  void summarize_aiDisabled_noWorkspace_503() {
    long userId = TestFixtures.createHuman(dsl);
    long accountId = createAccount(userId, "no-ai@test.local", false);
    long folderId = folderRepo.ensureFolder(accountId, "INBOX").id();
    long msgId = insertMessage(accountId, folderId, "svc-msg-2@test.local", "svc-thread-2");

    assertThatThrownBy(() -> mailAiService.summarize(userId, msgId))
        .isInstanceOf(MailAiUnavailableException.class);
    verify(mailClient, never()).analyzeContent(any());
  }

  /** 짧은 본문은 요약 생략 → EMPTY(버튼도 숨김), 두 번째 GET 은 LLM 을 다시 부르지 않는다. */
  @Test
  void summarize_shortBody_emptyAndNoRetry() {
    long userId = TestFixtures.createHuman(dsl);
    long accountId = createAccount(userId, "ai-short@test.local", false);
    long folderId = folderRepo.ensureFolder(accountId, "INBOX").id();
    long msgId = insertMessage(accountId, folderId, "svc-short@test.local", "svc-short-t", "짧은 본문");
    stubAssistant();
    when(mailClient.analyzeContent(any())).thenReturn(new AnalyzeContentResult("업무", null));

    assertThat(mailAiService.summarize(userId, msgId)).isEqualTo(MailSummary.empty());
    assertThat(mailAiService.summarize(userId, msgId)).isEqualTo(MailSummary.empty());
    ArgumentCaptor<AnalyzeContentRequest> req =
        ArgumentCaptor.forClass(AnalyzeContentRequest.class);
    verify(mailClient, times(1)).analyzeContent(req.capture());
    assertThat(req.getValue().includeSummary()).isFalse();
  }

  /** 자동 발송 + 긴 본문 → SKIPPED(버튼). 강제 생성은 미리보기가 아닌 새 본문으로 요약만 요청하고 READY. */
  @Test
  void summarize_autoGeneratedLong_skipped_thenForceReady() {
    long userId = TestFixtures.createHuman(dsl);
    long accountId = createAccount(userId, "ai-auto@test.local", false);
    long folderId = folderRepo.ensureFolder(accountId, "INBOX").id();
    long msgId =
        insertMessage(
            accountId,
            folderId,
            "svc-auto@test.local",
            "svc-auto-t",
            MailAnalysisFixtures.LONG_BODY);
    contentRepo.markAutoGenerated(contentIdOf(msgId));
    stubAssistant();
    when(mailClient.analyzeContent(any()))
        .thenReturn(new AnalyzeContentResult("뉴스레터", null))
        .thenReturn(new AnalyzeContentResult(null, "• 강제 요약"));

    assertThat(mailAiService.summarize(userId, msgId).status())
        .isEqualTo(MailSummaryStatus.SKIPPED);
    assertThat(mailAiService.forceSummarize(userId, msgId)).isEqualTo(MailSummary.ready("• 강제 요약"));

    ArgumentCaptor<AnalyzeContentRequest> req =
        ArgumentCaptor.forClass(AnalyzeContentRequest.class);
    verify(mailClient, times(2)).analyzeContent(req.capture());
    AnalyzeContentRequest forced = req.getAllValues().get(1);
    assertThat(forced.includeSummary()).isTrue();
    assertThat(forced.includeCategory()).isFalse();
    assertThat(forced.body()).contains("배포 일정"); // 미리보기("스니펫")가 아닌 새 본문
    assertThat(mailAiService.summarize(userId, msgId)).isEqualTo(MailSummary.ready("• 강제 요약"));
  }

  /** 개인 티어(AI 사용 + 개인 비서) + 미분석 → ④ 전체 분석으로 개인 요약 READY. */
  @Test
  void summarize_personalTier_notAnalyzed_runsPersonalAnalysis() {
    long userId = TestFixtures.createHuman(dsl);
    long accountId = createAccount(userId, "ai-personal@test.local", true);
    long folderId = folderRepo.ensureFolder(accountId, "INBOX").id();
    long msgId =
        insertMessage(
            accountId, folderId, "svc-p@test.local", "svc-p-t", MailAnalysisFixtures.LONG_BODY);
    stubAssistant();
    AssistantSpec personal = new AssistantSpec(6L, "claude-sonnet-4-6", "NORMAL", 8, 60000);
    when(assistantResolver.resolvePersonalOrEmpty(anyLong())).thenReturn(Optional.of(personal));
    when(mailClient.analyzePersonal(any()))
        .thenReturn(new AnalyzePersonalResult(false, "• 핵심: 배포 일정", true, null));

    assertThat(mailAiService.summarize(userId, msgId)).isEqualTo(MailSummary.ready("• 핵심: 배포 일정"));
    verify(mailClient, times(1)).analyzePersonal(any());
    verify(mailClient, never()).analyzeContent(any());
  }

  /** 개인 요약 생략(짧은 본문)은 GET 마다 재생성하지 않는다 — 생략 표시가 "시도함" 역할. */
  @Test
  void summarize_personalSkipped_notRegenerated() {
    long userId = TestFixtures.createHuman(dsl);
    long accountId = createAccount(userId, "ai-pskip@test.local", true);
    long folderId = folderRepo.ensureFolder(accountId, "INBOX").id();
    long msgId = insertMessage(accountId, folderId, "svc-ps@test.local", "svc-ps-t", "짧은 본문");
    stubAssistant();
    when(assistantResolver.resolvePersonalOrEmpty(anyLong()))
        .thenReturn(Optional.of(new AssistantSpec(6L, "claude-sonnet-4-6", "NORMAL", 8, 60000)));
    when(mailClient.analyzePersonal(any()))
        .thenReturn(new AnalyzePersonalResult(false, null, false, null));

    assertThat(mailAiService.summarize(userId, msgId)).isEqualTo(MailSummary.empty());
    assertThat(mailAiService.summarize(userId, msgId)).isEqualTo(MailSummary.empty());
    verify(mailClient, times(1)).analyzePersonal(any());
  }

  /** 강제 생성인데 비서가 없으면 503. */
  @Test
  void forceSummarize_noAssistant_503() {
    long userId = TestFixtures.createHuman(dsl);
    long accountId = createAccount(userId, "ai-force-none@test.local", false);
    long folderId = folderRepo.ensureFolder(accountId, "INBOX").id();
    long msgId = insertMessage(accountId, folderId, "svc-fn@test.local", "svc-fn-t");

    assertThatThrownBy(() -> mailAiService.forceSummarize(userId, msgId))
        .isInstanceOf(MailAiUnavailableException.class);
  }

  /** #484 개인 티어: LLM 이 빈 개인 요약을 내면 EMPTY, 재조회 시 재호출 없음(MailTwoTierSummaryTest 의 같은 검증을 옮김). */
  @Test
  void summarize_personalTier_llmBlank_emptyAndNoRetry() {
    long userId = TestFixtures.createHuman(dsl);
    long accountId = createAccount(userId, "ai-pblank@test.local", true);
    long folderId = folderRepo.ensureFolder(accountId, "INBOX").id();
    long msgId =
        insertMessage(
            accountId, folderId, "svc-pb@test.local", "svc-pb-t", MailAnalysisFixtures.LONG_BODY);
    stubAssistant();
    when(assistantResolver.resolvePersonalOrEmpty(anyLong()))
        .thenReturn(Optional.of(new AssistantSpec(6L, "claude-sonnet-4-6", "NORMAL", 8, 60000)));
    when(mailClient.analyzePersonal(any()))
        .thenReturn(new AnalyzePersonalResult(false, " ", true, null));

    assertThat(mailAiService.summarize(userId, msgId)).isEqualTo(MailSummary.empty());
    assertThat(mailAiService.summarize(userId, msgId)).isEqualTo(MailSummary.empty());
    verify(mailClient, times(1)).analyzePersonal(any());
  }

  /**
   * 판단 13: 읽은 메일은 선제 분석 대상이 아니지만, 상세를 열면 GET …/summary 가 "아직 분석 전 → 즉시 생성" 경로로 요약을 만든다 — seen 게이트가
   * analyzeContent 에 들어가면 이 테스트가 깨진다.
   */
  @Test
  void summarize_readMail_analyzedOnOpen() {
    long userId = TestFixtures.createHuman(dsl);
    long accountId = createAccount(userId, "ai-read@test.local", false);
    long folderId = folderRepo.ensureFolder(accountId, "INBOX").id();
    long msgId =
        insertMessage(
            accountId,
            folderId,
            "svc-read@test.local",
            "svc-read-t",
            MailAnalysisFixtures.LONG_BODY);
    messageRepo.markSeen(msgId); // 웹 열람과 같은 읽음 처리(WP-148: seen_push_pending 도 함께 켜짐 — 요약과 무관)
    stubAssistant();
    when(mailClient.analyzeContent(any())).thenReturn(new AnalyzeContentResult("업무", "• 읽은 메일 요약"));

    assertThat(mailAiService.summarize(userId, msgId)).isEqualTo(MailSummary.ready("• 읽은 메일 요약"));
    verify(mailClient, times(1)).analyzeContent(any());
  }

  /** 새 메일 초안(inReplyToMessageId=null): thread 빈 리스트로 호출, 결과 매핑. */
  @Test
  void coachDraft_새메일_thread비어있음() {
    stubAssistant();
    long userId = TestFixtures.createHuman(dsl);
    long accountId = createAccount(userId, "ai@test.local", true);
    when(mailClient.coachDraft(any()))
        .thenReturn(
            new DraftCoachingResult(
                List.of(new CoachingNoteWire("TONE", "명령조가 강해요")), "<p>개선</p>"));

    MailDraftCoaching out =
        mailAiService.coachDraft(
            userId, new MailDraftCoachingRequest(accountId, "<p>빨리</p>", "빨리", null));

    assertThat(out.notes()).hasSize(1);
    assertThat(out.notes().get(0).dimension()).isEqualTo("TONE");
    assertThat(out.improvedBodyHtml()).isEqualTo("<p>개선</p>");
    ArgumentCaptor<DraftCoachingRequest> cap = ArgumentCaptor.forClass(DraftCoachingRequest.class);
    verify(mailClient).coachDraft(cap.capture());
    assertThat(cap.getValue().thread()).isEmpty();
    assertThat(cap.getValue().draftBody()).isEqualTo("빨리");
    assertThat(cap.getValue().replyingAs()).isEqualTo("ai@test.local");
  }

  /** 답장 초안(inReplyToMessageId 지정): 원문 스레드가 동봉되어 호출된다. */
  @Test
  void coachDraft_답장_스레드동봉() {
    stubAssistant();
    long userId = TestFixtures.createHuman(dsl);
    long accountId = createAccount(userId, "ai2@test.local", true);
    long folderId = folderRepo.ensureFolder(accountId, "INBOX").id();
    long msgId = insertMessage(accountId, folderId, "co-msg-1@test.local", "co-thread-1");
    when(mailClient.coachDraft(any())).thenReturn(new DraftCoachingResult(List.of(), "<p>개선</p>"));

    mailAiService.coachDraft(
        userId, new MailDraftCoachingRequest(accountId, "<p>답장</p>", "답장", msgId));

    ArgumentCaptor<DraftCoachingRequest> cap = ArgumentCaptor.forClass(DraftCoachingRequest.class);
    verify(mailClient).coachDraft(cap.capture());
    assertThat(cap.getValue().thread()).isNotEmpty();
  }

  /** ai_enabled=false 계정 → coachDraft 차단(503). */
  @Test
  void coachDraft_aiEnabled_false_차단() {
    long userId = TestFixtures.createHuman(dsl);
    long accountId = createAccount(userId, "no-ai-co@test.local", false);

    assertThatThrownBy(
            () ->
                mailAiService.coachDraft(
                    userId, new MailDraftCoachingRequest(accountId, "<p>x</p>", "x", null)))
        .isInstanceOf(MailAiUnavailableException.class);
  }

  /** 타 계정 accountId → 404(EmailAccountNotFoundException). */
  @Test
  void coachDraft_타계정_404() {
    long owner = TestFixtures.createHuman(dsl);
    long accountId = createAccount(owner, "owner-co@test.local", true);
    long stranger = TestFixtures.createHuman(dsl);

    assertThatThrownBy(
            () ->
                mailAiService.coachDraft(
                    stranger, new MailDraftCoachingRequest(accountId, "<p>x</p>", "x", null)))
        .isInstanceOf(EmailAccountNotFoundException.class);
  }
}
