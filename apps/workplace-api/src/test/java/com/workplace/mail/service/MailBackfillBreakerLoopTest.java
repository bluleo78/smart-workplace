package com.workplace.mail.service;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.doCallRealMethod;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.workplace.mail.dto.BodyTarget;
import com.workplace.mail.exception.MailAiException;
import com.workplace.mail.exception.MailAiUnavailableException;
import com.workplace.mail.repository.EmailMessageRepository;
import com.workplace.mail.service.MailAnalysisBreaker.Admission;
import com.workplace.mail.service.MailAnalysisService.AfterLoadOutcome;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.SimpleTransactionStatus;

/** WP-1812 회로 차단기가 걸리는 나머지 두 백필 루프 — AI 켬 개인 분석 백필·적재 후 분석 루프. */
class MailBackfillBreakerLoopTest {

  private static final long USER = 7L;
  private static final long ACCOUNT = 9L;

  private EmailMessageRepository repo;
  private MailAnalysisService analysis;
  private MailAnalysisBreaker breaker;
  private PlatformTransactionManager tx;

  @BeforeEach
  void setUp() {
    repo = mock(EmailMessageRepository.class);
    analysis = mock(MailAnalysisService.class);
    breaker = mock(MailAnalysisBreaker.class);
    // 목 차단기 기본 — 입장 허용, 오류 기록은 실제 규약(모델 실패만 recordFailure)을 따른다
    when(breaker.admit(anyLong())).thenReturn(Admission.GO);
    doCallRealMethod().when(breaker).onError(anyLong(), any());
    tx = mock(PlatformTransactionManager.class);
    when(tx.getTransaction(any(TransactionDefinition.class)))
        .thenReturn(new SimpleTransactionStatus());
  }

  private MailClassifyBackfillService classify() {
    return new MailClassifyBackfillService(repo, analysis, tx, breaker);
  }

  /** 적재 후 분석 루프 대상 1건(INBOX, 적재 성공)을 만든 backfill 서비스. */
  private MailBackfillService backfill(long... ids) {
    MailBodyFetcher fetcher = mock(MailBodyFetcher.class);
    BodyTarget[] targets = new BodyTarget[ids.length];
    for (int i = 0; i < ids.length; i++) {
      targets[i] = new BodyTarget(ids[i], ACCOUNT, 5L, "INBOX", null, null, 100L);
      when(fetcher.fetchBody(USER, targets[i])).thenReturn(true);
    }
    when(repo.listMissingBody(ACCOUNT, MailBackfillService.BATCH_LIMIT))
        .thenReturn(List.of(targets));
    return new MailBackfillService(
        repo,
        fetcher,
        mock(MailSyncProgress.class),
        analysis,
        tx,
        mock(MailPushService.class),
        breaker,
        Runnable::run);
  }

  @Test
  void classify_openBreaker_neverAnalyzes() {
    when(repo.listRecentUnreadUnanalyzedIds(ACCOUNT, MailClassifyBackfillService.LIMIT))
        .thenReturn(List.of(1L, 2L));
    when(breaker.admit(anyLong())).thenReturn(Admission.OPEN);

    classify().classifyRecentUnreadNow(USER, ACCOUNT);

    verify(analysis, never()).analyzePersonal(anyLong(), anyLong(), any());
  }

  @Test
  void classify_aiFailure_isRecorded() {
    when(repo.listRecentUnreadUnanalyzedIds(ACCOUNT, MailClassifyBackfillService.LIMIT))
        .thenReturn(List.of(1L));
    when(analysis.analyzePersonal(anyLong(), anyLong(), any()))
        .thenThrow(new MailAiException("boom", null));

    classify().classifyRecentUnreadNow(USER, ACCOUNT);

    verify(breaker).recordFailure(1L);
  }

  @Test
  void afterLoad_openBreaker_neverAnalyzes() {
    when(breaker.admit(anyLong())).thenReturn(Admission.OPEN);

    backfill(1L, 2L).backfillNow(USER, ACCOUNT);

    verify(analysis, never()).analyzeAfterLoad(anyLong(), anyLong(), any());
  }

  @Test
  void afterLoad_aiFailedOutcome_isRecorded() {
    when(analysis.analyzeAfterLoad(anyLong(), anyLong(), any()))
        .thenReturn(AfterLoadOutcome.AI_FAILED);

    backfill(1L).backfillNow(USER, ACCOUNT);

    verify(breaker).recordFailure(1L);
    verify(breaker, never()).recordSuccess();
  }

  @Test
  void afterLoad_respondedOutcome_recordsSuccess() {
    when(analysis.analyzeAfterLoad(anyLong(), anyLong(), any()))
        .thenReturn(AfterLoadOutcome.RESPONDED);

    backfill(1L).backfillNow(USER, ACCOUNT);

    verify(breaker).recordSuccess();
    verify(breaker, never()).recordFailure(anyLong());
  }

  @Test
  void classify_transientUnavailable503_isRecorded() {
    when(repo.listRecentUnreadUnanalyzedIds(ACCOUNT, MailClassifyBackfillService.LIMIT))
        .thenReturn(List.of(1L));
    when(analysis.analyzePersonal(anyLong(), anyLong(), any()))
        .thenThrow(new MailAiUnavailableException("재기동 중"));

    classify().classifyRecentUnreadNow(USER, ACCOUNT);

    verify(breaker).recordFailure(1L);
  }

  @Test
  void classify_permanentUnavailableReason_isNotRecorded() {
    when(repo.listRecentUnreadUnanalyzedIds(ACCOUNT, MailClassifyBackfillService.LIMIT))
        .thenReturn(List.of(1L));
    when(analysis.analyzePersonal(anyLong(), anyLong(), any()))
        .thenThrow(MailAiUnavailableException.aiDisabled());

    classify().classifyRecentUnreadNow(USER, ACCOUNT);

    verify(breaker, never()).recordFailure(anyLong());
  }

  @Test
  void afterLoad_transientUnavailable503Thrown_isRecorded() {
    when(analysis.analyzeAfterLoad(anyLong(), anyLong(), any()))
        .thenThrow(new MailAiUnavailableException("재기동 중"));

    backfill(1L).backfillNow(USER, ACCOUNT);

    verify(breaker).recordFailure(1L);
  }

  @Test
  void afterLoad_permanentUnavailableReasonThrown_isNotRecorded() {
    when(analysis.analyzeAfterLoad(anyLong(), anyLong(), any()))
        .thenThrow(MailAiUnavailableException.assistantNotConfigured());

    backfill(1L).backfillNow(USER, ACCOUNT);

    verify(breaker, never()).recordFailure(anyLong());
  }
}
