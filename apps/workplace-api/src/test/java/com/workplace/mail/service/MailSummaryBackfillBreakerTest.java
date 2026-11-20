package com.workplace.mail.service;

import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;

import com.workplace.mail.exception.MailAiException;
import com.workplace.mail.exception.MailAiUnavailableException;
import com.workplace.mail.repository.EmailMessageRepository;
import com.workplace.mail.service.MailAnalysisBreaker.Admission;
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

/** WP-1812 요약 백필 루프(runPass)에 회로 차단기가 걸리는 동작 — 열림·메일별 건너뜀·실패/성공 기록. */
@ExtendWith(MockitoExtension.class)
class MailSummaryBackfillBreakerTest {

  private static final long USER = 1L;
  private static final long ACCOUNT = 2L;

  @Mock private EmailMessageRepository messageRepo;
  @Mock private MailBodyFetcher bodyFetcher;
  @Mock private MailAnalysisService analysis;
  @Mock private PlatformTransactionManager txManager;
  @Mock private MailAnalysisBreaker breaker;

  private MailSummaryBackfillService service;

  @BeforeEach
  void setUp() {
    lenient()
        .when(txManager.getTransaction(ArgumentMatchers.any(TransactionDefinition.class)))
        .thenReturn(new SimpleTransactionStatus());
    lenient()
        .when(messageRepo.findBodyTargetForUser(anyLong(), anyLong()))
        .thenReturn(Optional.empty());
    // 목 차단기 기본 — 입장 허용, 오류 기록은 실제 규약(모델 실패만 recordFailure)을 따른다
    lenient().when(breaker.admit(anyLong())).thenReturn(Admission.GO);
    lenient().doCallRealMethod().when(breaker).onError(anyLong(), ArgumentMatchers.any());
    service =
        new MailSummaryBackfillService(messageRepo, bodyFetcher, analysis, txManager, breaker);
  }

  private void contentTargets(Long... ids) {
    given(messageRepo.listRecentUnreadUnsummarizedIds(ACCOUNT, 20)).willReturn(List.of(ids));
  }

  @Test
  void openBreakerSkipsPass() {
    contentTargets(10L, 11L);
    given(breaker.admit(anyLong())).willReturn(Admission.OPEN);

    service.summarizeObjectiveRecentNow(USER, ACCOUNT);

    verify(analysis, never()).analyzeContent(anyLong(), anyLong());
    verify(analysis, never()).analyzePersonal(anyLong(), anyLong(), ArgumentMatchers.any());
  }

  @Test
  void skipsBackedOffMessage() {
    contentTargets(10L, 11L);
    given(breaker.admit(10L)).willReturn(Admission.SKIP);

    service.summarizeObjectiveRecentNow(USER, ACCOUNT);

    verify(analysis, never()).analyzeContent(USER, 10L);
    verify(analysis).analyzeContent(USER, 11L);
  }

  @Test
  void aiFailureIsRecorded() {
    contentTargets(10L);
    given(analysis.analyzeContent(USER, 10L)).willThrow(new MailAiException("boom", null));

    service.summarizeObjectiveRecentNow(USER, ACCOUNT);

    verify(breaker).recordFailure(10L);
  }

  @Test
  void transientUnavailable503IsRecorded() {
    contentTargets(10L);
    given(analysis.analyzeContent(USER, 10L)).willThrow(new MailAiUnavailableException("재기동 중"));

    service.summarizeObjectiveRecentNow(USER, ACCOUNT);

    verify(breaker).recordFailure(10L);
  }

  @Test
  void permanentUnavailableReasonIsNotRecorded() {
    contentTargets(10L);
    given(analysis.analyzeContent(USER, 10L)).willThrow(MailAiUnavailableException.aiDisabled());

    service.summarizeObjectiveRecentNow(USER, ACCOUNT);

    verify(breaker, never()).recordFailure(anyLong());
  }

  @Test
  void bodyFetchFailureIsNotRecorded() {
    contentTargets(10L);
    given(messageRepo.findBodyTargetForUser(USER, 10L))
        .willThrow(new RuntimeException("imap down"));

    service.summarizeObjectiveRecentNow(USER, ACCOUNT);

    verify(breaker, never()).recordFailure(anyLong());
  }

  @Test
  void responseRecordsSuccess() {
    contentTargets(10L);
    given(analysis.analyzeContent(USER, 10L)).willReturn(true);

    service.summarizeObjectiveRecentNow(USER, ACCOUNT);

    verify(breaker).recordSuccess();
  }
}
