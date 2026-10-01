package com.workplace.mail;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.calls;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.workplace.mail.dto.BodyTarget;
import com.workplace.mail.repository.EmailMessageRepository;
import com.workplace.mail.service.MailAnalysisService;
import com.workplace.mail.service.MailBackfillService;
import com.workplace.mail.service.MailBodyFetcher;
import com.workplace.mail.service.MailSyncProgress;
import java.util.List;
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

    new MailBackfillService(repo, fetcher, progress, analysis, tx).backfillNow(7L, 9L);

    InOrder order = inOrder(progress, analysis);
    order.verify(progress, calls(1)).finish(9L);
    order.verify(analysis).analyzeAfterLoad(7L, 1L);
    verify(analysis, never()).analyzeAfterLoad(7L, 2L);
    verify(progress, times(1)).finish(9L); // 분석 뒤 두 번째 finish 가 다음 동기화 상태를 지우지 않는다
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
    doThrow(new RuntimeException("boom")).when(analysis).analyzeAfterLoad(7L, 1L);

    new MailBackfillService(repo, fetcher, progress, analysis, tx).backfillNow(7L, 9L);

    verify(progress, times(1)).finish(9L);
    verify(analysis).analyzeAfterLoad(7L, 2L);
  }
}
