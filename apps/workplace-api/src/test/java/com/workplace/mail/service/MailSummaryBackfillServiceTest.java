package com.workplace.mail.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;

import com.workplace.mail.dto.BodyTarget;
import com.workplace.mail.repository.EmailMessageRepository;
import com.workplace.mail.repository.EmailMessageRepository.AiContext;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.SimpleTransactionStatus;

/**
 * MailSummaryBackfillService 단위 테스트. Spring 컨텍스트 없이 Mockito 만으로 서비스 로직 검증 — (a) T1 객관적 패스:
 * ensureObjectiveSummary 호출, (b) T2 개인 패스: ensurePersonalSummary 호출, (c) 본문 없음 → bodyFetcher 호출 후
 * ensure 위임.
 */
@ExtendWith(MockitoExtension.class)
class MailSummaryBackfillServiceTest {

  private static final long USER = 1L;
  private static final long ACCOUNT = 2L;

  /** T1 테스트용 — ai_enabled=false 계정(ai_disabled)과 그 소유자. */
  private static final long USER_DISABLED = 10L;

  private static final long ACCOUNT_AI_DISABLED = 3L;

  /** T2 테스트용 — ai_enabled=true 계정과 그 소유자. */
  private static final long USER_ENABLED = 11L;

  private static final long ACCOUNT_AI_ENABLED = 4L;

  @Mock private EmailMessageRepository messageRepo;
  @Mock private MailBodyFetcher bodyFetcher;
  @Mock private MailAiService mailAiService;
  @Mock private PlatformTransactionManager txManager;

  private MailSummaryBackfillService service;

  @BeforeEach
  void setUp() {
    // TransactionTemplate 이 txManager.getTransaction() 을 호출할 때 더미 상태 반환
    // → execute(callback) 이 콜백을 동기 실행하도록 허용.
    org.mockito.Mockito.lenient()
        .when(
            txManager.getTransaction(org.mockito.ArgumentMatchers.any(TransactionDefinition.class)))
        .thenReturn(new SimpleTransactionStatus());
    service = new MailSummaryBackfillService(messageRepo, bodyFetcher, mailAiService, txManager);
  }

  /**
   * AiContext 생성 헬퍼 — 필드 순서: aiEnabled, selfAddress, subject, fromAddress, bodyText, bodyHtml,
   * summary, personalSummary
   */
  private static AiContext aiContext(String bodyText, String bodyHtml) {
    return new AiContext(
        true, "self@test.local", "제목", "from@test.local", bodyText, bodyHtml, null, null);
  }

  // ─── T1 objective pass ────────────────────────────────────────────────────

  /**
   * T1: 공통비서가 있으면(seedWorkspaceAssistantWithToken 역할 — ensureObjectiveSummary 가 stub 처리), 미요약 대상
   * 메시지에 대해 ensureObjectiveSummary 가 호출된다.
   */
  @Test
  void objectivePass_fillsContentSummary_forAiDisabledAccount_whenWorkspaceAssistant() {
    // ai_disabled 계정의 T1 미요약 대상 메시지
    long msg = 30L;
    given(messageRepo.listRecentUnreadUnsummarizedIds(ACCOUNT_AI_DISABLED, 20))
        .willReturn(List.of(msg));
    // 본문 이미 적재됨 → ensureBody skip
    given(messageRepo.findBodyTargetForUser(USER_DISABLED, msg)).willReturn(Optional.empty());

    service.summarizeObjectiveRecentNow(USER_DISABLED, ACCOUNT_AI_DISABLED);

    // 공통비서 존재 여부는 ensureObjectiveSummary 내부에서 판단 — 호출이 위임되었는지만 검증
    verify(mailAiService).ensureObjectiveSummary(USER_DISABLED, msg);
  }

  // ─── T2 personal pass ─────────────────────────────────────────────────────

  /**
   * T2: 개인비서가 있으면(seedPersonalAssistantWithToken 역할), 미개인요약 대상 메시지에 대해 ensurePersonalSummary 가
   * 호출된다.
   */
  @Test
  void personalPass_fillsEnvelopeSummary_forAiEnabledAccountWithPersonalAssistant() {
    long msg = 40L;
    given(messageRepo.listRecentUnreadUnpersonalizedIds(ACCOUNT_AI_ENABLED, 20))
        .willReturn(List.of(msg));
    given(messageRepo.findBodyTargetForUser(USER_ENABLED, msg)).willReturn(Optional.empty());

    service.summarizePersonalRecentNow(USER_ENABLED, ACCOUNT_AI_ENABLED);

    verify(mailAiService).ensurePersonalSummary(USER_ENABLED, msg);
  }

  // ─── 기존 로직 회귀 ───────────────────────────────────────────────────────

  /** T1 패스: 본문 있는 메시지는 ensureObjectiveSummary 호출, 본문 없는 메시지는 ensureBody 시도 후 위임. */
  @Test
  void objectivePass_본문있으면_objective요약호출_본문없으면_bodyFetch후_위임() {
    given(messageRepo.listRecentUnreadUnsummarizedIds(ACCOUNT, 20)).willReturn(List.of(10L, 11L));
    // 10L: 본문 이미 적재됨
    given(messageRepo.findBodyTargetForUser(USER, 10L)).willReturn(Optional.empty());
    // 11L: 본문 미적재(imapUid=5, bodyFetchedAt=null)
    BodyTarget fetchNeeded = new BodyTarget(11L, 99L, 5L, "INBOX", null, null, 0L);
    given(messageRepo.findBodyTargetForUser(USER, 11L)).willReturn(Optional.of(fetchNeeded));

    service.summarizeObjectiveRecentNow(USER, ACCOUNT);

    verify(mailAiService).ensureObjectiveSummary(USER, 10L);
    verify(bodyFetcher).fetchBody(USER, fetchNeeded);
    verify(mailAiService).ensureObjectiveSummary(USER, 11L);
    // ensurePersonalSummary 는 T1 패스에서 호출되지 않음
    verify(mailAiService, never()).ensurePersonalSummary(anyLong(), anyLong());
  }

  /** T2 패스: ensurePersonalSummary 만 호출, ensureObjectiveSummary 는 호출되지 않음. */
  @Test
  void personalPass_ensurePersonalSummary만_호출() {
    given(messageRepo.listRecentUnreadUnpersonalizedIds(ACCOUNT, 20)).willReturn(List.of(20L));
    given(messageRepo.findBodyTargetForUser(USER, 20L)).willReturn(Optional.empty());

    service.summarizePersonalRecentNow(USER, ACCOUNT);

    verify(mailAiService).ensurePersonalSummary(USER, 20L);
    verify(mailAiService, never()).ensureObjectiveSummary(anyLong(), anyLong());
  }

  /** 대상 목록이 null(txTemplate 반환) 이면 아무것도 하지 않는다. */
  @Test
  void objectivePass_ids가_null이면_아무것도안함() {
    given(messageRepo.listRecentUnreadUnsummarizedIds(ACCOUNT, 20)).willReturn(null);

    service.summarizeObjectiveRecentNow(USER, ACCOUNT);

    verify(mailAiService, never()).ensureObjectiveSummary(anyLong(), anyLong());
  }

  /** 메시지별 예외가 터져도 나머지 메시지를 계속 처리한다(best-effort). */
  @Test
  void objectivePass_메시지별_예외가터져도_루프계속() {
    given(messageRepo.listRecentUnreadUnsummarizedIds(ACCOUNT, 20)).willReturn(List.of(50L, 51L));
    given(messageRepo.findBodyTargetForUser(eq(USER), anyLong())).willReturn(Optional.empty());
    // 50L 처리 시 예외
    org.mockito.Mockito.doThrow(new RuntimeException("LLM 오류"))
        .when(mailAiService)
        .ensureObjectiveSummary(USER, 50L);

    service.summarizeObjectiveRecentNow(USER, ACCOUNT);

    // 예외에도 불구하고 51L 도 처리됨
    verify(mailAiService).ensureObjectiveSummary(USER, 51L);
  }

  /** assertThat 가져오기 검증 — AiContext summary/personalSummary 필드 확인용 헬퍼 동작. */
  @Test
  void aiContext_헬퍼_필드순서_검증() {
    AiContext ctx = aiContext("본문", null);
    assertThat(ctx.bodyText()).isEqualTo("본문");
    assertThat(ctx.summary()).isNull();
    assertThat(ctx.personalSummary()).isNull();
  }
}
