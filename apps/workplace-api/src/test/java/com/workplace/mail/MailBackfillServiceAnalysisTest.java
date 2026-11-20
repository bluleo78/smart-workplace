package com.workplace.mail;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.calls;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.workplace.global.tenant.TenantContext;
import com.workplace.mail.dto.BodyTarget;
import com.workplace.mail.dto.EmailAccountResponse;
import com.workplace.mail.repository.EmailMessageRepository;
import com.workplace.mail.service.MailAnalysisBreaker;
import com.workplace.mail.service.MailAnalysisService;
import com.workplace.mail.service.MailBackfillService;
import com.workplace.mail.service.MailBodyFetcher;
import com.workplace.mail.service.MailPushService;
import com.workplace.mail.service.MailPushService.NewMailPush;
import com.workplace.mail.service.MailSyncProgress;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.Executor;
import java.util.concurrent.RejectedExecutionException;
import org.junit.jupiter.api.Test;
import org.mockito.InOrder;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.SimpleTransactionStatus;

/** WP-149 본문 적재 직후 분석 — 이번에 적재된 메일만, 진행바를 끝낸 뒤(트랜잭션 밖) 분석한다. */
class MailBackfillServiceAnalysisTest {

  @Test
  void backfillNow_analyzesOnlyNewlyLoaded_afterProgressFinish() {
    EmailMessageRepository repo = mock(EmailMessageRepository.class);
    MailBodyFetcher fetcher = mock(MailBodyFetcher.class);
    MailSyncProgress progress = mock(MailSyncProgress.class);
    MailAnalysisService analysis = mock(MailAnalysisService.class);
    PlatformTransactionManager tx = mock(PlatformTransactionManager.class);
    when(tx.getTransaction(any(TransactionDefinition.class)))
        .thenReturn(new SimpleTransactionStatus());
    BodyTarget loaded = new BodyTarget(1L, 9L, 5L, "INBOX", null, null, 100L);
    BodyTarget failed = new BodyTarget(2L, 9L, 6L, "INBOX", null, null, 101L);
    when(repo.listMissingBody(9L, MailBackfillService.BATCH_LIMIT))
        .thenReturn(List.of(loaded, failed));
    when(fetcher.fetchBody(7L, loaded)).thenReturn(true);
    when(fetcher.fetchBody(7L, failed)).thenReturn(false);

    new MailBackfillService(
            repo,
            fetcher,
            progress,
            analysis,
            tx,
            mock(MailPushService.class),
            new MailAnalysisBreaker(),
            Runnable::run)
        .backfillNow(7L, 9L);

    InOrder order = inOrder(progress, analysis);
    order.verify(progress, calls(1)).finish(9L);
    order.verify(analysis).analyzeAfterLoad(eq(7L), eq(1L), any());
    verify(analysis, never()).analyzeAfterLoad(eq(7L), eq(2L), any());
    verify(progress, times(1)).finish(9L); // 분석 뒤 두 번째 finish 가 다음 동기화 상태를 지우지 않는다
  }

  /**
   * 받은편지함 메일 한 건(id 1)을 본문 보충해 적재하는 보충 서비스 — 적재 후 분석은 {@code analysisExecutor} 로 넘긴다(WP-1812 리뷰 후속
   * 시험용).
   */
  private static MailBackfillService oneLoaded(
      MailSyncProgress progress, MailAnalysisService analysis, Executor analysisExecutor) {
    EmailMessageRepository repo = mock(EmailMessageRepository.class);
    MailBodyFetcher fetcher = mock(MailBodyFetcher.class);
    PlatformTransactionManager tx = mock(PlatformTransactionManager.class);
    when(tx.getTransaction(any(TransactionDefinition.class)))
        .thenReturn(new SimpleTransactionStatus());
    BodyTarget loaded = new BodyTarget(1L, 9L, 5L, "INBOX", null, null, 100L);
    when(repo.listMissingBody(9L, MailBackfillService.BATCH_LIMIT)).thenReturn(List.of(loaded));
    when(fetcher.fetchBody(7L, loaded)).thenReturn(true);
    return new MailBackfillService(
        repo,
        fetcher,
        progress,
        analysis,
        tx,
        mock(MailPushService.class),
        new MailAnalysisBreaker(),
        analysisExecutor);
  }

  /** WP-1812 리뷰 후속: 적재 후 분석(LLM)은 본문 보충 스레드에서 돌지 않고 분석 실행기로 넘긴다 — 넘긴 작업이 돌기 전에는 분석하지 않는다. */
  @Test
  void backfillNow_handsAnalysisToAnalysisExecutor() {
    MailSyncProgress progress = mock(MailSyncProgress.class);
    MailAnalysisService analysis = mock(MailAnalysisService.class);
    var handedOff = new ArrayList<Runnable>();

    oneLoaded(progress, analysis, handedOff::add).backfillNow(7L, 9L);

    verify(progress, times(1)).finish(9L);
    verify(analysis, never()).analyzeAfterLoad(anyLong(), anyLong(), any());
    assertThat(handedOff).hasSize(1);
    handedOff.get(0).run();
    verify(analysis).analyzeAfterLoad(eq(7L), eq(1L), any());
  }

  /** WP-1812 리뷰 후속: 분석 실행기가 거절해도 보충은 예외 없이 끝나고 분석은 건너뛴다(요약 백필이 이어 맡는다). */
  @Test
  void backfillNow_analysisExecutorRejects_skipsAnalysis() {
    MailSyncProgress progress = mock(MailSyncProgress.class);
    MailAnalysisService analysis = mock(MailAnalysisService.class);
    Executor rejecting =
        task -> {
          throw new RejectedExecutionException("가득 참");
        };

    oneLoaded(progress, analysis, rejecting).backfillNow(7L, 9L);

    verify(progress, times(1)).finish(9L);
    verify(analysis, never()).analyzeAfterLoad(anyLong(), anyLong(), any());
  }

  /** 분석이 던져도 finish 는 다시 호출되지 않고, 다음 메일 분석은 계속된다. */
  @Test
  void backfillNow_analysisFailure_doesNotFinishAgain() {
    EmailMessageRepository repo = mock(EmailMessageRepository.class);
    MailBodyFetcher fetcher = mock(MailBodyFetcher.class);
    MailSyncProgress progress = mock(MailSyncProgress.class);
    MailAnalysisService analysis = mock(MailAnalysisService.class);
    PlatformTransactionManager tx = mock(PlatformTransactionManager.class);
    when(tx.getTransaction(any(TransactionDefinition.class)))
        .thenReturn(new SimpleTransactionStatus());
    BodyTarget a = new BodyTarget(1L, 9L, 5L, "INBOX", null, null, 100L);
    BodyTarget b = new BodyTarget(2L, 9L, 6L, "INBOX", null, null, 101L);
    when(repo.listMissingBody(9L, MailBackfillService.BATCH_LIMIT)).thenReturn(List.of(a, b));
    when(fetcher.fetchBody(7L, a)).thenReturn(true);
    when(fetcher.fetchBody(7L, b)).thenReturn(true);
    doThrow(new RuntimeException("boom")).when(analysis).analyzeAfterLoad(eq(7L), eq(1L), any());

    new MailBackfillService(
            repo,
            fetcher,
            progress,
            analysis,
            tx,
            mock(MailPushService.class),
            new MailAnalysisBreaker(),
            Runnable::run)
        .backfillNow(7L, 9L);

    verify(progress, times(1)).finish(9L);
    verify(analysis).analyzeAfterLoad(eq(7L), eq(2L), any());
  }

  /** 적재가 21건이어도 적재 후 분석은 최근 수신 순 상위 20건만(공유 executor 점유 제한). */
  @Test
  void backfillNow_analyzesOnlyTop20Loaded() {
    EmailMessageRepository repo = mock(EmailMessageRepository.class);
    MailBodyFetcher fetcher = mock(MailBodyFetcher.class);
    MailSyncProgress progress = mock(MailSyncProgress.class);
    MailAnalysisService analysis = mock(MailAnalysisService.class);
    PlatformTransactionManager tx = mock(PlatformTransactionManager.class);
    when(tx.getTransaction(any(TransactionDefinition.class)))
        .thenReturn(new SimpleTransactionStatus());
    // listMissingBody 는 최근 수신 순 — id 1 이 가장 최신
    List<BodyTarget> targets = new java.util.ArrayList<>();
    for (long i = 1; i <= 21; i++) {
      BodyTarget t = new BodyTarget(i, 9L, 100L + i, "INBOX", null, null, 200L + i);
      targets.add(t);
      when(fetcher.fetchBody(7L, t)).thenReturn(true);
    }
    when(repo.listMissingBody(9L, MailBackfillService.BATCH_LIMIT)).thenReturn(targets);

    new MailBackfillService(
            repo,
            fetcher,
            progress,
            analysis,
            tx,
            mock(MailPushService.class),
            new MailAnalysisBreaker(),
            Runnable::run)
        .backfillNow(7L, 9L);

    verify(analysis, times(MailBackfillService.ANALYZE_AFTER_LOAD_LIMIT))
        .analyzeAfterLoad(eq(7L), anyLong(), any());
    verify(analysis).analyzeAfterLoad(eq(7L), eq(1L), any());
    verify(analysis).analyzeAfterLoad(eq(7L), eq(20L), any());
    verify(analysis, never()).analyzeAfterLoad(eq(7L), eq(21L), any());
  }

  /**
   * WP-1739: 발송 정보를 받은 보충은 진행바를 끝낸 직후·분석 전에 새 메일 푸시를 보낸다 — 본문(자동 발송 헤더 판정)이 적재된 뒤라 WORK 판정이 맞고, 수 분
   * 걸릴 수 있는 분석을 기다리지 않는다.
   */
  @Test
  void backfillWithPush_sendsAfterFinish_beforeAnalysis() {
    EmailMessageRepository repo = mock(EmailMessageRepository.class);
    MailBodyFetcher fetcher = mock(MailBodyFetcher.class);
    MailSyncProgress progress = mock(MailSyncProgress.class);
    MailAnalysisService analysis = mock(MailAnalysisService.class);
    MailPushService push = mock(MailPushService.class);
    PlatformTransactionManager tx = mock(PlatformTransactionManager.class);
    when(tx.getTransaction(any(TransactionDefinition.class)))
        .thenReturn(new SimpleTransactionStatus());
    BodyTarget loaded = new BodyTarget(1L, 9L, 5L, "INBOX", null, null, 100L);
    when(repo.listMissingBody(9L, MailBackfillService.BATCH_LIMIT)).thenReturn(List.of(loaded));
    when(fetcher.fetchBody(7L, loaded)).thenReturn(true);
    EmailAccountResponse account = mock(EmailAccountResponse.class);
    TenantContext.set(1L);
    try {
      new MailBackfillService(
              repo, fetcher, progress, analysis, tx, push, new MailAnalysisBreaker(), Runnable::run)
          .backfill(7L, 9L, new NewMailPush(account, 3L));
    } finally {
      TenantContext.clear();
    }

    InOrder order = inOrder(progress, push, analysis);
    order.verify(progress).finish(9L);
    order.verify(push).sendNewMail(7L, account, 3L);
    order.verify(analysis).analyzeAfterLoad(eq(7L), eq(1L), any());
  }

  /** 보충이 실패해도(대상 조회 예외) 발송은 한다 — 「애매하면 보냄」, 본문이 없으면 예전처럼 헤더 판정 없이 판정된다. */
  @Test
  void backfillWithPush_failure_stillSends() {
    EmailMessageRepository repo = mock(EmailMessageRepository.class);
    MailPushService push = mock(MailPushService.class);
    MailSyncProgress progress = mock(MailSyncProgress.class);
    PlatformTransactionManager tx = mock(PlatformTransactionManager.class);
    when(tx.getTransaction(any(TransactionDefinition.class)))
        .thenReturn(new SimpleTransactionStatus());
    when(repo.listMissingBody(9L, MailBackfillService.BATCH_LIMIT))
        .thenThrow(new RuntimeException("imap down"));
    EmailAccountResponse account = mock(EmailAccountResponse.class);
    TenantContext.set(1L);
    try {
      new MailBackfillService(
              repo,
              mock(MailBodyFetcher.class),
              progress,
              mock(MailAnalysisService.class),
              tx,
              push,
              new MailAnalysisBreaker(),
              Runnable::run)
          .backfill(7L, 9L, new NewMailPush(account, 3L));
    } finally {
      TenantContext.clear();
    }

    verify(progress).finish(9L);
    verify(push).sendNewMail(7L, account, 3L);
  }

  /** 발송 정보 없는 보충(backfillNow·첫 동기화)은 푸시하지 않는다 — 새 메일 푸시는 동기화 경로에서만 나간다. */
  @Test
  void backfillNow_withoutPush_neverSends() {
    EmailMessageRepository repo = mock(EmailMessageRepository.class);
    MailPushService push = mock(MailPushService.class);
    PlatformTransactionManager tx = mock(PlatformTransactionManager.class);
    when(tx.getTransaction(any(TransactionDefinition.class)))
        .thenReturn(new SimpleTransactionStatus());
    when(repo.listMissingBody(9L, MailBackfillService.BATCH_LIMIT)).thenReturn(List.of());

    new MailBackfillService(
            repo,
            mock(MailBodyFetcher.class),
            mock(MailSyncProgress.class),
            mock(MailAnalysisService.class),
            tx,
            push,
            new MailAnalysisBreaker(),
            Runnable::run)
        .backfillNow(7L, 9L);

    verify(push, never()).sendNewMail(anyLong(), any(), anyLong());
  }
}
