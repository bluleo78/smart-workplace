package com.workplace.mail.service;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;

import com.workplace.global.tenant.TenantContext;
import com.workplace.mail.dto.BodyTarget;
import com.workplace.mail.exception.MailAiException;
import com.workplace.mail.exception.MailAiUnavailableException;
import com.workplace.mail.repository.EmailMessageRepository;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentMatchers;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.SimpleTransactionStatus;
import org.springframework.web.client.ResourceAccessException;

/**
 * WP-149 동기화 후 선제 백필 단위 테스트 — ③ 패스는 원본 미분석(content.ai_summarized_at) 대상에 analyzeContent, ④ 패스는 사본
 * 미분석 대상에 analyzePersonal. 본문이 없으면 먼저 적재하고, 메시지별 실패는 삼킨다.
 */
@ExtendWith(MockitoExtension.class)
class MailSummaryBackfillServiceTest {

  private static final long USER = 1L;
  private static final long ACCOUNT = 2L;

  @Mock private EmailMessageRepository messageRepo;
  @Mock private MailBodyFetcher bodyFetcher;
  @Mock private MailAnalysisService analysis;
  @Mock private PlatformTransactionManager txManager;

  private MailSummaryBackfillService service;

  @BeforeEach
  void setUp() {
    lenient()
        .when(txManager.getTransaction(ArgumentMatchers.any(TransactionDefinition.class)))
        .thenReturn(new SimpleTransactionStatus());
    service = new MailSummaryBackfillService(messageRepo, bodyFetcher, analysis, txManager);
  }

  @Test
  void contentPass_loadsMissingBody_thenAnalyzesContent() {
    given(messageRepo.listRecentUnreadUnsummarizedIds(ACCOUNT, 20)).willReturn(List.of(10L, 11L));
    given(messageRepo.findBodyTargetForUser(USER, 10L)).willReturn(Optional.empty());
    BodyTarget fetchNeeded = new BodyTarget(11L, 99L, 5L, "INBOX", null, null, 0L);
    given(messageRepo.findBodyTargetForUser(USER, 11L)).willReturn(Optional.of(fetchNeeded));

    service.summarizeObjectiveRecentNow(USER, ACCOUNT);

    verify(analysis).analyzeContent(USER, 10L);
    verify(bodyFetcher).fetchBody(USER, fetchNeeded);
    verify(analysis).analyzeContent(USER, 11L);
    verify(analysis, never()).analyzePersonal(anyLong(), anyLong(), any());
  }

  @Test
  void personalPass_usesUnanalyzedTargets() {
    given(messageRepo.listRecentUnreadUnanalyzedIds(ACCOUNT, 20)).willReturn(List.of(20L));
    given(messageRepo.findBodyTargetForUser(USER, 20L)).willReturn(Optional.empty());

    service.summarizePersonalRecentNow(USER, ACCOUNT);

    verify(analysis).analyzePersonal(eq(USER), eq(20L), any());
    verify(analysis, never()).analyzeContent(anyLong(), anyLong());
  }

  @Test
  void nullTargets_doNothing() {
    given(messageRepo.listRecentUnreadUnsummarizedIds(ACCOUNT, 20)).willReturn(null);

    service.summarizeObjectiveRecentNow(USER, ACCOUNT);

    verify(analysis, never()).analyzeContent(anyLong(), anyLong());
  }

  @Test
  void perMessageFailure_continues() {
    given(messageRepo.listRecentUnreadUnsummarizedIds(ACCOUNT, 20)).willReturn(List.of(50L, 51L));
    given(messageRepo.findBodyTargetForUser(eq(USER), anyLong())).willReturn(Optional.empty());
    doThrow(new RuntimeException("LLM 오류")).when(analysis).analyzeContent(USER, 50L);

    service.summarizeObjectiveRecentNow(USER, ACCOUNT);

    verify(analysis).analyzeContent(USER, 51L);
  }

  /** ai-agent 연결 실패(재기동 중 등) — 클라이언트가 ResourceAccessException 을 감싼 형태. */
  private static MailAiException agentDown() {
    return new MailAiException("AI 요청 실패", new ResourceAccessException("Connection refused"));
  }

  @Test
  void agentUnavailable_threeInARow_stopsPass() {
    given(messageRepo.listRecentUnreadUnsummarizedIds(ACCOUNT, 20))
        .willReturn(List.of(60L, 61L, 62L, 63L, 64L));
    given(messageRepo.findBodyTargetForUser(eq(USER), anyLong())).willReturn(Optional.empty());
    doThrow(agentDown()).when(analysis).analyzeContent(eq(USER), anyLong());

    // 연속 3회 불가에서 패스를 멈춘다 — 남은 2건은 부르지 않는다(스케줄러는 같은 guard 로 회차를 멈춘다)
    service.summarizeObjectiveRecentNow(USER, ACCOUNT);
    verify(analysis, times(3)).analyzeContent(eq(USER), anyLong());
    verify(analysis, never()).analyzeContent(USER, 63L);
  }

  @Test
  void agentUnavailable_streakResetsOnlyOnAgentResponse() {
    given(messageRepo.listRecentUnreadUnsummarizedIds(ACCOUNT, 20))
        .willReturn(List.of(70L, 71L, 72L, 73L, 74L, 75L));
    given(messageRepo.findBodyTargetForUser(eq(USER), anyLong())).willReturn(Optional.empty());
    // 불가 2 → agent 응답(72) 으로 리셋 → 불가(503) 1 → 메일 단위 실패(리셋 없음) → 불가 1: 연속 3회가 없으므로 끝까지 돈다
    given(analysis.analyzeContent(USER, 72L)).willReturn(true);
    doThrow(agentDown()).when(analysis).analyzeContent(USER, 70L);
    doThrow(agentDown()).when(analysis).analyzeContent(USER, 71L);
    doThrow(new MailAiUnavailableException("503")).when(analysis).analyzeContent(USER, 73L);
    doThrow(new RuntimeException("파싱 오류")).when(analysis).analyzeContent(USER, 74L);
    doThrow(agentDown()).when(analysis).analyzeContent(USER, 75L);

    service.summarizeObjectiveRecentNow(USER, ACCOUNT);

    verify(analysis, times(6)).analyzeContent(eq(USER), anyLong());
  }

  @Test
  void asyncEntry_agentUnavailable_skipsPersonalPass() {
    TenantContext.set(1L);
    try {
      given(messageRepo.listRecentUnreadUnsummarizedIds(ACCOUNT, 20))
          .willReturn(List.of(80L, 81L, 82L));
      given(messageRepo.findBodyTargetForUser(eq(USER), anyLong())).willReturn(Optional.empty());
      doThrow(agentDown()).when(analysis).analyzeContent(eq(USER), anyLong());

      // 동기화 직후 비동기 진입점 — ③ 이 agent 불가로 멈추면 같은 agent 를 부르는 ④ 패스도 건너뛴다
      service.summarizeRecentUnread(USER, ACCOUNT);

      verify(messageRepo, never()).listRecentUnreadUnanalyzedIds(anyLong(), anyInt());
      verify(analysis, never()).analyzePersonal(anyLong(), anyLong(), any());
    } finally {
      TenantContext.clear();
    }
  }

  @Test
  void agentUnavailable_mailsThatSkipAgent_doNotResetStreak() {
    given(messageRepo.listRecentUnreadUnsummarizedIds(ACCOUNT, 20))
        .willReturn(List.of(90L, 91L, 92L, 93L, 94L, 95L));
    given(messageRepo.findBodyTargetForUser(eq(USER), anyLong())).willReturn(Optional.empty());
    // agent 불가와 "agent 를 부르지 않은 메일(빈 본문 등, false)"이 번갈아 와도 연속 횟수는 이어진다 — 95 앞에서 멈춘다
    doThrow(agentDown()).when(analysis).analyzeContent(USER, 90L);
    doThrow(agentDown()).when(analysis).analyzeContent(USER, 92L);
    doThrow(agentDown()).when(analysis).analyzeContent(USER, 94L);

    service.summarizeObjectiveRecentNow(USER, ACCOUNT);

    verify(analysis, never()).analyzeContent(USER, 95L);
  }
}
