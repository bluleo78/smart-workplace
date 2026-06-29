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
import com.workplace.mail.dto.ParsedMessage;
import com.workplace.mail.exception.EmailAccountNotFoundException;
import com.workplace.mail.exception.MailAiUnavailableException;
import com.workplace.mail.outbound.AiAgentMailClient;
import com.workplace.mail.outbound.MailAiMessages.CoachingNoteWire;
import com.workplace.mail.outbound.MailAiMessages.DraftCoachingRequest;
import com.workplace.mail.outbound.MailAiMessages.DraftCoachingResult;
import com.workplace.mail.outbound.MailAiMessages.SummarizeResult;
import com.workplace.mail.repository.EmailAccountRepository;
import com.workplace.mail.repository.EmailContentRepository;
import com.workplace.mail.repository.EmailFolderRepository;
import com.workplace.mail.repository.EmailMessageRepository;
import com.workplace.mail.service.MailAiService;
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
    return envId;
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

  /**
   * ai_enabled=false + 공통비서 없음 → 503(MailAiUnavailableException). 새 모델: ai_enabled=false 자체는 게이트가
   * 아님 — 공통비서(resolveWorkspaceOrEmpty)로 T1 시도 후 둘 다 없으면 503.
   */
  @Test
  void summarize_aiEnabled_false_공통비서없음_요약차단() {
    long userId = TestFixtures.createHuman(dsl);
    long accountId = createAccount(userId, "no-ai@test.local", false);
    long folderId = folderRepo.ensureFolder(accountId, "INBOX").id();
    long msgId = insertMessage(accountId, folderId, "svc-msg-2@test.local", "svc-thread-2");

    assertThatThrownBy(() -> mailAiService.summarize(userId, msgId))
        .isInstanceOf(MailAiUnavailableException.class);

    verify(mailClient, never()).summarize(any());
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
